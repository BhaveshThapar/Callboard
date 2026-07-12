import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `@/db` reads DATABASE_URL when it loads.
const { db } = await import("@/db");
const { scores } = await import("@/db/schema");
const { resolveJudgeActor, listTeamsForJudge } = await import("@/lib/auth/scope");
const { getRubric } = await import("@/lib/comp/tab");

/**
 * Writes a full set of scores for one judge *straight into the table*, with no `latestLockedRun`
 * guard in front of it.
 *
 * This is not a shortcut around the UI — it is the only way to produce the state the UI cannot be
 * made to produce on demand. `submitScores` refuses to write once a run exists, but that check and
 * that insert are two acts over a driver with no transactions, so a judge submitting at the instant
 * the board locks can still land a row. What that race leaves behind is a score the locked result
 * never saw, and this reproduces it deterministically.
 *
 * The values invert the ranking on purpose: if a correction were to pick these up, the winner would
 * change. That is what makes the assertion in the spec worth making.
 */
const flag = (name: string): string => {
  const i = process.argv.indexOf(name);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (!value) throw new Error(`missing ${name}`);
  return value;
};

const actor = await resolveJudgeActor(flag("--judge-token"));
if (!actor) throw new Error("judge token did not resolve");

const [teams, rubric] = await Promise.all([listTeamsForJudge(actor), getRubric(actor.compId)]);

const rows = teams.flatMap((team, teamIndex) =>
  rubric.criteria.map((criterion) => ({
    compId: actor.compId,
    judgeAssignmentId: actor.judgeAssignmentId,
    teamId: team.id,
    criterionId: criterion.id,
    // Ascending in team index, where every other judge scored descending. A last-place team gets
    // top marks, so a run that counted these would not have the same winner.
    rawValue: Math.min(criterion.maxPoints, teamIndex * 3),
  })),
);

await db.insert(scores).values(rows);

console.log(String(rows.length));
