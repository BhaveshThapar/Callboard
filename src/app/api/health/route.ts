import { readConfigEnv } from "@/db/config-env";
import type { HealthPayload } from "@/db/health";
import { observeSchemaVersion } from "@/db/schema-version";

/**
 * What this deployment has applied, and what it is configured to do — asked of the one process that
 * actually knows both.
 *
 * **This is the credential-free half of the migration guard.** Neon `main` sat at `0006` while
 * Vercel served code expecting `0010`, and every Module A screen returned 500 for nineteen days; the
 * preflight that would have caught it on day one was pointed at `dev` and printed the same green
 * line. CI needs to ask production how far along it is, and the alternative was a production
 * database credential in GitHub Actions. This is the same answer without the credential: the process
 * that already legitimately holds `DATABASE_URL` does the reading, and CI reads two integers.
 *
 * It is also what gives `db:doctor --host` its subject. `db:doctor` is documented as being run with
 * production's `DATABASE_URL` in front of it, which means `process.env.RESEND_API_KEY` is still the
 * operator's laptop — a config verdict about the wrong machine, printed under a line that says *the
 * deployed demo*.
 *
 * **The projection is the scope**, which is this repo's rule for every read with no `Actor` behind
 * it. Two integers and a handful of states: no org, no comp, no team, no person, no money, no
 * hostname, and no value read out of `process.env` — only whether one is set, and where it is unset,
 * its *name*. Re-adding a field is a compile error against `HealthPayload` rather than a review
 * somebody has to pass.
 *
 * On disclosure: every bit here is already observable from outside. `/api/cron/send` answers 503
 * when `CRON_SECRET` is unset and 404 when it is set, the import screen says "not configured" in so
 * many words, and `protected.ts` commits the production compute id on the argument that a hostname
 * component is not a credential. A schema version is that same class of fact.
 */

/**
 * Not a style preference. `next build` runs in CI against a fake `DATABASE_URL` on the stated
 * premise that no page here is statically rendered — a prerendered health route would try to connect
 * at build time and break the build.
 */
export const dynamic = "force-dynamic";

export const GET = async (): Promise<Response> => {
  const { migrationsApplied, migrationsExpected } = await observeSchemaVersion();

  const payload: HealthPayload = {
    migrations: { applied: migrationsApplied, expected: migrationsExpected },
    // The same read `db:doctor` does, so what a host reports about itself and what the CLI would
    // have concluded locally cannot disagree.
    config: readConfigEnv(),
  };

  return Response.json(payload, {
    // A cached health endpoint is a green check that is a lie about a fact that has changed, which
    // is this repo's signature defect served from a CDN. `/api/cron/send` sets the same header.
    headers: { "cache-control": "no-store" },
  });
};
