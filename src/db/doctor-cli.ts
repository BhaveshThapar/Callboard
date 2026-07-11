import { readFileSync } from "node:fs";
import { config } from "dotenv";

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

const health = await checkDemoHealth(compConfig);

if (health.ok) {
  console.log(
    `\n✓ Demo healthy: board "${health.board}", ${health.judges} judges, ${health.teams} teams.\n`,
  );
} else {
  console.error(["", "✗ Demo not ready:", ...health.problems.map((p) => `  - ${p}`), ""].join("\n"));
  process.exit(1);
}
