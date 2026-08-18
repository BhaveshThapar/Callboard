/**
 * P3 — the session-variable plumbing layer, which is the cost [ADR-0006](../../docs/decisions/0006-tenancy-app-layer-scoping-rls-later.md)
 * priced row-level security at and the reason it was deferred.
 *
 * It turns out to be one shim, because of a single line in drizzle's neon-http driver:
 *
 *     this.clientQuery = client.query ?? client;
 *
 * So a client is anything with a `.query(sql, params, opts)`. This provides one that wraps every
 * statement in `transaction([set_config, statement])` — **one HTTP round trip, not two** — and every
 * query drizzle issues through it arrives with `app.comp_id` already set. `src/lib/auth/scope.ts`'s
 * fourteen call sites are untouched; they take a `db` and do not know which one.
 *
 * Four things had to be true for this to work at all, and each was measured rather than assumed:
 *
 * 1. **A GUC survives inside `transaction()` on neon-http.** `e2e/rls-spike.spec.ts` (#33) proved it
 *    carries between the two statements and does **not** leak to the next request on the same pooled
 *    endpoint — both halves, because either alone passes vacuously.
 * 2. **It cannot come from the connection string.** `?options=-c app.comp_id=…` reads back `null`;
 *    neon-http does not forward startup parameters. The batch is the only mechanism.
 * 3. **The role must not bypass.** `neondb_owner` has `rolbypassrls = true`, and so does
 *    `neon_superuser`, which every role created through Neon's console or API inherits. A
 *    `callboard_app` made the obvious way carries policies correctly and **denies nothing** — the
 *    purest form of this repo's recurring defect, and one that passes every test written against it.
 *    So the role is created with raw SQL and an explicit `NOBYPASSRLS`.
 * 4. **It fails closed.** With no `app.comp_id` set, a policy keyed on `current_setting(..., true)`
 *    compares against `null` and returns **zero rows**. A request that forgets the scope sees
 *    nothing rather than everything, which is the only direction this is allowed to fail in.
 *
 * The cost is ~2–5% on an eight-way fan-out, measured by the same spike.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * The app role's connection string, which is **not** `DATABASE_URL`.
 *
 * Two connections on purpose. `DATABASE_URL` is the owner and stays the owner: migrations,
 * `db:seed`, `db:doctor` and the CLI tooling all need to read and write across comps, and none of
 * them has a request behind it to be scoped by. `DATABASE_URL_APP` is the non-owner the product
 * serves requests as, and it is the only one policies apply to.
 *
 * Unset means P3 is not enabled on this deployment, and that is a **caveat rather than a hazard**:
 * the app falls back to the owner connection and behaves exactly as it did before, with app-layer
 * scoping doing the work it has always done. What it must never do is pretend — `db:doctor` reports
 * which of the two is in use, because a deployment that believes it has RLS and does not is worse
 * than one that knows it has none.
 */
const appConnectionString = process.env.DATABASE_URL_APP;

export const rlsEnabled = (): boolean => appConnectionString !== undefined;

/**
 * A database handle whose every statement is scoped to one comp by the database itself.
 *
 * Returns the ordinary owner-connected handle when `DATABASE_URL_APP` is unset, so a deployment
 * without the role behaves as before rather than failing. The scoping is defence in depth: every
 * read here already goes through `src/lib/auth/scope.ts` and already carries its own `where`. This
 * is what stops the fifteenth query — the one somebody writes in a hurry — from being the exception.
 */
export const dbForComp = (compId: string) => {
  if (!appConnectionString) return null;

  const base = neon(appConnectionString);
  type NeonClient = {
    query: (sql: string, params?: unknown[], opts?: unknown) => unknown;
    transaction: (queries: unknown[], opts?: unknown) => Promise<unknown[]>;
  };
  const client = base as unknown as NeonClient;

  return drizzle(
    {
      query: async (sql: string, params?: unknown[], opts?: unknown) => {
        const out = await client.transaction(
          [
            // `is_local = true`: scoped to this transaction, so it cannot outlive the batch even if
            // the underlying connection is reused. The spike proved it does not leak either way;
            // this makes that a property of the statement rather than of the pool's behaviour.
            client.query("select set_config('app.comp_id', $1, true)", [compId], opts),
            client.query(sql, params, opts),
          ],
          opts,
        );
        return out[out.length - 1];
      },
    } as never,
    { schema },
  );
};
