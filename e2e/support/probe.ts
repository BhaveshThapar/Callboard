import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `@/db` reads DATABASE_URL when it loads.
const { db } = await import("@/db");
const { deductions, judgeNotes, scores, teams } = await import("@/db/schema");
const { asc, count, eq } = await import("drizzle-orm");

/**
 * Reads and writes the spec cannot make through the product, because the product is what is on
 * trial. `rows` is the assertion that matters: a refused write must leave *no row*, and the refusal
 * message on screen is not evidence of that — `scores.team_id`, `judge_notes.team_id` and
 * `deductions.team_id` are all bare FKs, so the database would have taken the row happily.
 */
const [command, argument] = process.argv.slice(2);
if (!command || !argument) throw new Error("usage: probe.ts <teams|rows|drop> <id>");

if (command === "teams") {
  const roster = await db
    .select({ id: teams.id, name: teams.name, bidCode: teams.bidCode })
    .from(teams)
    .where(eq(teams.compId, argument))
    .orderBy(asc(teams.bidCode));
  console.log(JSON.stringify(roster));
} else if (command === "rows") {
  const [[score], [note], [deduction]] = await Promise.all([
    db.select({ n: count() }).from(scores).where(eq(scores.teamId, argument)),
    db.select({ n: count() }).from(judgeNotes).where(eq(judgeNotes.teamId, argument)),
    db.select({ n: count() }).from(deductions).where(eq(deductions.teamId, argument)),
  ]);
  console.log(
    JSON.stringify({ scores: score?.n ?? 0, notes: note?.n ?? 0, deductions: deduction?.n ?? 0 }),
  );
} else if (command === "drop") {
  await db.update(teams).set({ status: "dropped" }).where(eq(teams.id, argument));
  console.log("dropped");
} else {
  throw new Error(`unknown command: ${command}`);
}
