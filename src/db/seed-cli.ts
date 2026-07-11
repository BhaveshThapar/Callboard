import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `./index` reads DATABASE_URL when it loads.
const { seedDemo, seedFromConfig, DEMO_CONFIG } = await import("./seed");
const { parseCompConfig } = await import("./config");
const { checkDemoHealth } = await import("./doctor");

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const jsonPath = flag("--json");
const configPath = flag("--config");

const compConfig = configPath
  ? parseCompConfig(JSON.parse(readFileSync(configPath, "utf8")))
  : DEMO_CONFIG;

const seeded = configPath ? await seedFromConfig(compConfig) : await seedDemo();

// Prove the links resolve against this database's live schema before handing any of them out.
// A seed that cannot pass its own health check would otherwise print a board link that 404s mid-call.
const health = await checkDemoHealth(compConfig);
if (!health.ok) {
  console.error(
    ["", "✗ Seed did not verify:", ...health.problems.map((p) => `  - ${p}`), ""].join("\n"),
  );
  process.exit(1);
}

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(seeded, null, 2));
} else {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const pad = Math.max(...[...seeded.board, ...seeded.judges].map((p) => p.name.length));

  console.log(
    [
      "",
      `Seeded ${seeded.compName}: ${compConfig.teams.length} teams, ${seeded.judges.length} judges, ` +
        `${compConfig.rubric.normalization} normalization.`,
      "",
      "Board (open on a laptop):",
      ...seeded.board.map((b) => `  ${b.name.padEnd(pad)}  ${baseUrl}/board/${b.token}`),
      "",
      "Judges (one per phone):",
      ...seeded.judges.map((j) => `  ${j.name.padEnd(pad)}  ${baseUrl}/judge/${j.token}`),
      "",
      "These raw tokens are shown once. Only their hashes are stored.",
      "",
    ].join("\n"),
  );

  // The health check is DB-only and cannot see this: localhost links resolve on your machine and
  // dead-404 on a prospect's phone. Warn loudly, but don't fail — local dev seeding is meant to use it.
  if (/\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(baseUrl)) {
    console.error(
      [
        "",
        `⚠ These links point at ${baseUrl} — they only work on this machine.`,
        "  Set NEXT_PUBLIC_BASE_URL to the demo's public URL before handing links to a phone.",
        "",
      ].join("\n"),
    );
  }
}
