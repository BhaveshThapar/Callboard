import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `@/db` reads DATABASE_URL when it loads.
const { db } = await import("@/db");
const { charges, depositEvents, teams } = await import("@/db/schema");
const { and, eq, isNull } = await import("drizzle-orm");
const { violatedConstraint } = await import("@/db/errors");
const { MONEY_CONSTRAINTS } = await import("@/db/schema");

/**
 * Writes deposit events straight at the database, bypassing `advanceDeposit`'s in-process guard.
 *
 * That bypass is the entire point. `advanceDeposit` reads the chain and refuses a second ending in
 * JavaScript, which is the right thing for a board that clicks twice — but the check and the insert
 * are two acts on neon-http, so two board members can land between them and the code cannot see it.
 * The claim under test is that **the index refuses it anyway**, from a path that never asked.
 *
 * Prints `refused:<constraint>` when the database says no, so the spec asserts on the constraint
 * name rather than on a message.
 */
const [command, compId, bidCode, state] = process.argv.slice(2);
if (!command || !compId || !bidCode) {
  throw new Error("usage: deposit.ts <append|state> <compId> <bidCode> [state]");
}

const [team] = await db
  .select({ id: teams.id })
  .from(teams)
  .where(and(eq(teams.compId, compId), eq(teams.bidCode, bidCode)))
  .limit(1);
if (!team) throw new Error(`no team ${bidCode} in comp ${compId}`);

/**
 * Provenance only, and nullable since `0011`: the chain is keyed on the team, so a deposit whose
 * charge has been voided — a dropped team's, a refunded one's — still has a chain to append to.
 * Looking one up is best-effort for that reason.
 */
const [deposit] = await db
  .select({ id: charges.id })
  .from(charges)
  .where(
    and(
      eq(charges.compId, compId),
      eq(charges.teamId, team.id),
      eq(charges.kind, "deposit"),
      isNull(charges.voidedAt),
    ),
  )
  .limit(1);

switch (command) {
  case "append": {
    if (!state) throw new Error("append requires a state");
    try {
      await db.insert(depositEvents).values({
        compId,
        teamId: team.id,
        chargeId: deposit?.id ?? null,
        state: state as "held",
        reason: "e2e",
      });
      console.log("appended");
    } catch (error) {
      const constraint = violatedConstraint(error);
      if (constraint === MONEY_CONSTRAINTS.depositTerminal) {
        console.log(`refused:${constraint}`);
        break;
      }
      throw error;
    }
    break;
  }

  case "state": {
    const events = await db
      .select({ seq: depositEvents.seq, state: depositEvents.state })
      .from(depositEvents)
      .where(eq(depositEvents.teamId, team.id));
    const { currentState } = await import("@/lib/money/deposit");
    console.log(currentState(events));
    break;
  }

  default:
    throw new Error(`unknown command: ${command}`);
}
