/**
 * The database half of the comp lifecycle. The decisions are `./lifecycle.ts`', which is pure and
 * tested without a database; this only reads and writes.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import type { CompStatus } from "@/db/schema";
import { comps, orgs } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor } from "@/lib/auth/scope";
import { canAdvanceComp } from "./lifecycle";

export type CompStatusResult = { ok: true; status: CompStatus } | { ok: false; message: string };

export type RegistrationWindow = {
  status: CompStatus;
  /** Where the public form lives, so the board can see the URL it is opening and closing. */
  path: string;
};

/**
 * Where this comp is in its lifecycle, and the address of the form that status governs.
 *
 * Comp-scoped off the actor, and not a window in `scope.ts`' sense: it resolves no id and reads no
 * team, score or person. `listRegistrationFieldsForBoard` is the same shape and says so for the same
 * reason — this is the comp's own configuration, not a claim about a row.
 */
export const registrationWindowFor = async (
  actor: BoardActor,
): Promise<RegistrationWindow | null> => {
  const [row] = await db
    .select({ status: comps.status, compSlug: comps.slug, orgSlug: orgs.slug })
    .from(comps)
    .innerJoin(orgs, eq(orgs.id, comps.orgId))
    .where(eq(comps.id, actor.compId))
    .limit(1);

  if (!row) return null;
  return { status: row.status, path: `/register/${row.orgSlug}/${row.compSlug}` };
};

/**
 * Moves a comp along its lifecycle — and, in doing so, opens or closes its registration form.
 *
 * This is the gap it closes: `comps.status` gates `openRegistration`, and **nothing in the product
 * ever wrote it**. The only writer was `src/db/seed.ts`, from the config. So a board that opened
 * registration could not close it: the sole instrument was a reseed, and a reseed replaces the comp
 * and reissues every token ([ADR-0013](../../../docs/decisions/0013-a-seed-replaces-a-comp-not-an-org.md)),
 * which kills the board and judge links already handed out. Closing a form meant destroying the
 * comp, so in practice nobody closed a form.
 *
 * No transaction: one statement, and one statement is atomic on neon-http without asking (ADR-0012
 * stays about invariants that genuinely span two).
 *
 * No claim to check, either. There is no id on the form but the token's own: comp scope comes from
 * `actor.compId`, which is what the link resolved to. This is the rare board write with nothing to
 * resolve, because its subject *is* the actor's comp.
 */
export const setCompStatus = async (
  actor: BoardActor,
  to: CompStatus,
): Promise<CompStatusResult> => {
  const [comp] = await db
    .select({ status: comps.status })
    .from(comps)
    .where(eq(comps.id, actor.compId))
    .limit(1);

  if (!comp) return { ok: false, message: "That comp no longer exists." };
  if (comp.status === to) return { ok: false, message: `This comp is already ${to}.` };

  if (!canAdvanceComp(comp.status, to)) {
    return {
      ok: false,
      message: `A comp that is ${comp.status} cannot become ${to}. The lifecycle only runs forward.`,
    };
  }

  await db.update(comps).set({ status: to }).where(eq(comps.id, actor.compId));

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "comp.status",
    entity: "comp",
    entityId: actor.compId,
    before: { status: comp.status },
    after: { status: to },
  });

  return { ok: true, status: to };
};
