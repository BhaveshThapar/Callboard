import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { hostnameOf, isProtectedDatabase } from "./protected";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `./index` reads DATABASE_URL when it loads.
const { checkDemoHealth } = await import("./doctor");
const { DEMO_CONFIG } = await import("./seed");
const { parseCompConfig } = await import("./config");

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const configPath = flag("--config");
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
  const host = url ? (hostnameOf(url) ?? "unparseable DATABASE_URL") : "DATABASE_URL not set";
  const compute = host.split(".")[0] ?? host;
  return isProtectedDatabase(url) ? `${compute} · the deployed demo` : compute;
})();

const health = await checkDemoHealth(compConfig);

if (health.ok) {
  console.log(
    `\n✓ Demo healthy: board "${health.board}", ${health.judges} judges, ${health.teams} teams.` +
      `\n  ${target}\n`,
  );
} else {
  console.error(
    ["", `✗ Demo not ready — ${target}:`, ...health.problems.map((p) => `  - ${p}`), ""].join("\n"),
  );
  process.exit(1);
}
