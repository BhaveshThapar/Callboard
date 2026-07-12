import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `@/db` reads DATABASE_URL when it loads.
const { db } = await import("@/db");
const { tabRuns } = await import("@/db/schema");
const { asc, eq } = await import("drizzle-orm");

/**
 * The diff between two adjacent runs in a comp's chain — the thing the audit trail cannot show you.
 *
 * Each run reproduces from its own frozen row, so a correction built from a *different world* than
 * the run it supersedes still verifies, and so does the run it replaced. Reproducibility is a
 * property of one row; continuity is a property of the pair, and nothing in the product reads it.
 * The spec does, so that a correction is provably a correction and not a re-derivation.
 */
const flag = (name: string): string => {
  const i = process.argv.indexOf(name);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const runs = await db
  .select({ inputs: tabRuns.inputs, supersedesId: tabRuns.supersedesId })
  .from(tabRuns)
  .where(eq(tabRuns.compId, flag("--comp-id")))
  .orderBy(asc(tabRuns.seq));

const [root, head] = runs;
if (!root || !head) throw new Error(`expected at least two runs, found ${runs.length}`);
if (head.supersedesId === null) throw new Error("the second run does not supersede the first");

const key = (s: { judgeId: string; teamId: string; criterionId: string; rawValue: number }): string =>
  `${s.judgeId}:${s.teamId}:${s.criterionId}:${s.rawValue}`;

const sorted = (input: typeof root.inputs): string[] => input.scores.map(key).sort();

const before = new Set(root.inputs.deductions.map((d) => `${d.teamId}:${d.points}:${d.reason}`));

console.log(
  JSON.stringify({
    scoresIdentical:
      JSON.stringify(sorted(root.inputs)) === JSON.stringify(sorted(head.inputs)) &&
      root.inputs.teams.length === head.inputs.teams.length &&
      root.inputs.judges.length === head.inputs.judges.length,
    deductionsAdded: head.inputs.deductions
      .filter((d) => !before.has(`${d.teamId}:${d.points}:${d.reason}`))
      .map((d) => ({ points: d.points, reason: d.reason })),
  }),
);
