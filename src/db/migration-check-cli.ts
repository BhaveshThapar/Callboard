import { compareMigrations } from "./health";
import { fetchHealth } from "./health-client";
import { migrationsExpected } from "./journal";

/**
 * Is the deployment behind the repo?
 *
 * From July 13 to August 1, 2026, Neon `main` sat at migration `0006` while Vercel served code
 * expecting `0010`. Every Module A screen and the public comp page returned HTTP 500 for nineteen
 * days while three waves of work merged green, because merging is not deploying and deploying is not
 * migrating — and the preflight that would have caught it on day one was being run against `dev`.
 *
 * **Imports nothing from `@/db`.** It asks the deployment over HTTP rather than connecting to
 * production's database, so CI needs no database credential at all — see `src/app/api/health/route.ts`.
 * `./index` throws at load when `DATABASE_URL` is unset, which is why the import list here is
 * exactly three pure modules.
 */
const host = process.env.PRODUCTION_URL;

if (!host) {
  console.error(
    "✗ PRODUCTION_URL is not set, so nothing was checked against production. A green check here would be a lie.",
  );
  process.exit(1);
}

const answer = await fetchHealth(host);

if (!answer.ok) {
  console.error(["", `✗ Could not ask ${host} what it has applied:`, `  - ${answer.reason}`, ""].join("\n"));
  process.exit(1);
}

const comparison = compareMigrations(answer.payload.migrations.applied, migrationsExpected);

/**
 * Naming the host on success as well as on failure, for the reason `db:doctor` prints its compute:
 * a verdict without its subject is what made a working instrument useless for eighteen days.
 */
if (comparison.state === "level" || comparison.state === "ahead") {
  const note =
    comparison.state === "ahead"
      ? ` (${comparison.applied} applied, ${comparison.expected} in this checkout — production is ahead, which is what a deploy in flight looks like)`
      : "";
  console.log(`\n✓ ${host} has applied all ${comparison.expected} migrations${note}.\n`);
  process.exit(0);
}

/**
 * `unknown` is fatal here and skipped in `db:doctor`, which is the whole reason `compareMigrations`
 * shares a *sentence* rather than a policy. A preflight that cannot tell should say nothing; CI
 * asking production how far along it is and hearing "there is no drizzle schema" has learned that it
 * reached something that is not the production database, which is worth failing over.
 */
const remedy =
  comparison.state === "behind"
    ? "Apply them with  DATABASE_URL='<neon main pooled>' bun run db:migrate  and then re-run this workflow."
    : "Check that PRODUCTION_URL points at the deployment you think it does.";

console.error(
  [
    "",
    `✗ ${host} is not up to date with this checkout:`,
    `  - ${comparison.sentence}`,
    "",
    `  ${remedy}`,
    "",
  ].join("\n"),
);
process.exit(1);
