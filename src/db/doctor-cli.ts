import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { hostnameOf, isProtectedDatabase } from "./protected";

// `CALLBOARD_ENV_FILE` so a test can drive an unset branch on a laptop whose `.env.local` supplies
// the variable. dotenv does not override an already-set variable, so an explicit env still wins.
config({ path: process.env.CALLBOARD_ENV_FILE ?? ".env.local", quiet: true });

// Imported after dotenv, because `./index` reads DATABASE_URL when it loads.
const { checkDemoHealth } = await import("./doctor");
const { DEMO_CONFIG } = await import("./seed");
const { parseCompConfig } = await import("./config");
const { fetchHealth } = await import("./health-client");
const { observeConfigFromPayload } = await import("./doctor");

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const configPath = flag("--config");
const host = flag("--host");
const compConfig = configPath
  ? parseCompConfig(JSON.parse(readFileSync(configPath, "utf8")))
  : DEMO_CONFIG;

/**
 * Which database this verdict is about.
 *
 * A preflight that says "healthy" without naming its target is the failure that actually happened:
 * on July 31, 2026 this printed a clean bill of health for the `dev` branch while the deployed demo
 * had been returning 500s for eighteen days. Both runs look identical in a terminal. Naming the
 * compute is what makes the difference visible in the same glance as the verdict — and saying *the
 * deployed demo* out loud is what makes its absence read as "you checked the wrong one".
 *
 * `hostnameOf` and `isProtectedDatabase` are the seeder's and the e2e guard's, not a second parser.
 */
const target = ((): string => {
  const url = process.env.DATABASE_URL;
  const hostname = url ? (hostnameOf(url) ?? "unparseable DATABASE_URL") : "DATABASE_URL not set";
  const compute = hostname.split(".")[0] ?? hostname;
  return isProtectedDatabase(url) ? `${compute} · the deployed demo` : compute;
})();

/**
 * The config half's subject, which is a different machine from the database half's.
 *
 * Without `--host` this process's own environment is all there is to read, and saying so is the
 * whole point: the documented invocation puts production's `DATABASE_URL` in front of a shell whose
 * `RESEND_API_KEY` is the operator's laptop. Failing to ask, and failing to say which was asked, are
 * two different defects and both were available here.
 */
const configObserved = await (async () => {
  if (!host) return undefined;

  const answer = await fetchHealth(host);
  if (!answer.ok) {
    console.error(["", `✗ Could not ask ${host} what it carries:`, `  - ${answer.reason}`, ""].join("\n"));
    process.exit(1);
  }
  return observeConfigFromPayload(answer.payload, host);
})();

const health = await checkDemoHealth(compConfig, configObserved);
const { caveats, hazards, source } = health.config;

const configSubject = typeof source === "string" ? "this shell, not the deployment" : source.host;

const configBlock = [
  ...(hazards.length > 0 || caveats.length > 0
    ? ["", `Configuration (${configSubject}):`, ...hazards.map((h) => `  ✗ ${h}`), ...caveats.map((c) => `  ⚠ ${c}`)]
    : ["", `Configuration (${configSubject}): everything set.`]),
  // Only worth saying when the database half is production's, because that is exactly when the two
  // subjects differ and the reader is most likely to take one line as covering both.
  ...(typeof source === "string" && isProtectedDatabase(process.env.DATABASE_URL)
    ? [
        "",
        "  Note: the verdict above is about this shell. db:doctor cannot see Vercel's environment.",
        "  Re-run with --host https://<the deployment> to ask the deployment itself.",
      ]
    : []),
];

if (health.ok) {
  console.log(
    `\n✓ Demo healthy: board "${health.board}", ${health.judges} judges, ${health.teams} teams.` +
      `\n  ${target}` +
      `\n${configBlock.join("\n")}\n`,
  );
} else {
  console.error(
    ["", `✗ Demo not ready — ${target}:`, ...health.problems.map((p) => `  - ${p}`), ...configBlock, ""].join("\n"),
  );
}

// The database verdict and the config verdict are separate questions and either can fail the run.
// A hazard is set-but-unusable or actively destructive -- somebody already did the work and the
// product is not getting it -- so it exits 1 wherever it is found, including on a laptop, because it
// is a fact about this process's environment rather than about whichever database it was pointed at.
// A caveat never does: production having no mail key is a deliberate, documented state, and a
// preflight that goes red for it is one that gets skipped before a call.
if (!health.ok || hazards.length > 0) process.exit(1);
