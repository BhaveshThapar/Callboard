import { writeFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `./index` reads DATABASE_URL when it loads.
const { seedDemo, DEMO_TEAMS, DEMO_JUDGES } = await import("./seed");

const jsonFlag = process.argv.indexOf("--json");
const jsonPath = jsonFlag === -1 ? null : process.argv[jsonFlag + 1];

const demo = await seedDemo();

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(demo, null, 2));
} else {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  console.log(
    [
      "",
      `Seeded ${demo.compName}: ${DEMO_TEAMS.length} teams, ${DEMO_JUDGES.length} judges, zscore + head-to-head tiebreak.`,
      "",
      "Board (open on a laptop):",
      `  ${baseUrl}/board/${demo.boardToken}`,
      "",
      "Judges (one per phone):",
      ...demo.judges.map((j) => `  ${j.name.padEnd(16)} ${baseUrl}/judge/${j.token}`),
      "",
      "These raw tokens are shown once. Only their hashes are stored.",
      "",
    ].join("\n"),
  );
}
