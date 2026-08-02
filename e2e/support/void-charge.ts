import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `@/db` reads DATABASE_URL when it loads.
const { db } = await import("@/db");
const { charges, teams } = await import("@/db/schema");
const { and, eq, isNull } = await import("drizzle-orm");

/**
 * Voids one live charge of a given kind, straight at the database.
 *
 * A fixture for a state the product cannot reach on demand and reaches on its own all the time: **a
 * charge the schedule says exists and the database does not have.** The realistic cause is the late
 * fee — `generateCharges` adds one once `asOf > lateAfter`, and until the regenerate path existed
 * nothing re-ran the schedule after a team's status had settled, so a comp that accepted its teams
 * in December billed nobody when the date passed in February.
 *
 * A test cannot move February. It can remove a charge the schedule still says is owed, which is the
 * same state arrived at from the other side — `e2e/support/chain.ts` and `break-db.ts` do exactly
 * this for the lock chain and the indexes.
 */
const [compId, bidCode, kind] = process.argv.slice(2);
if (!compId || !bidCode || !kind) {
  throw new Error("usage: void-charge.ts <compId> <bidCode> <kind>");
}

const [team] = await db
  .select({ id: teams.id })
  .from(teams)
  .where(and(eq(teams.compId, compId), eq(teams.bidCode, bidCode)))
  .limit(1);
if (!team) throw new Error(`no team ${bidCode} in comp ${compId}`);

const voided = await db
  .update(charges)
  .set({ voidedAt: new Date(), voidedReason: "e2e fixture" })
  .where(
    and(
      eq(charges.compId, compId),
      eq(charges.teamId, team.id),
      eq(charges.kind, kind),
      isNull(charges.voidedAt),
    ),
  )
  .returning({ id: charges.id, amountCents: charges.amountCents });

console.log(voided.length === 0 ? "none" : String(voided[0]?.amountCents));
