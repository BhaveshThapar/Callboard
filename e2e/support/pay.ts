import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `@/db` reads DATABASE_URL when it loads.
const { db } = await import("@/db");
const { charges, paymentAllocations, payments, teams } = await import("@/db/schema");
const { and, eq, isNull } = await import("drizzle-orm");

/**
 * Settles a team's live charges by the given number of cents, oldest-kind first.
 *
 * A test fixture, not a product path: `recordPayment` needs a `BoardActor`, and the money.spec
 * cases that need a paid team are about *reconciliation*, not about the payment screen. It writes
 * the counter and the allocations together so the result is a state `db:doctor` calls healthy —
 * a fixture that produced drift would make every later assertion meaningless.
 */
const [compId, bidCode, centsArg] = process.argv.slice(2);
if (!compId || !bidCode || !centsArg) {
  throw new Error("usage: pay.ts <compId> <bidCode> <cents>");
}

const [team] = await db
  .select({ id: teams.id })
  .from(teams)
  .where(and(eq(teams.compId, compId), eq(teams.bidCode, bidCode)))
  .limit(1);
if (!team) throw new Error(`no team ${bidCode} in comp ${compId}`);

const live = await db
  .select({ id: charges.id, amountCents: charges.amountCents })
  .from(charges)
  .where(and(eq(charges.compId, compId), eq(charges.teamId, team.id), isNull(charges.voidedAt)))
  .orderBy(charges.kind);

let remaining = Number(centsArg);
const allocations: { chargeId: string; amountCents: number }[] = [];
for (const charge of live) {
  if (remaining <= 0) break;
  const amount = Math.min(remaining, charge.amountCents);
  allocations.push({ chargeId: charge.id, amountCents: amount });
  remaining -= amount;
}

const allocated = allocations.reduce((sum, a) => sum + a.amountCents, 0);

const [payment] = await db
  .insert(payments)
  .values({
    compId,
    teamId: team.id,
    rail: "venmo",
    grossCents: Number(centsArg),
    feeCents: 0,
    netCents: Number(centsArg),
    allocatedCents: allocated,
  })
  .returning({ id: payments.id });
if (!payment) throw new Error("payment insert returned no row");

if (allocations.length > 0) {
  await db
    .insert(paymentAllocations)
    .values(allocations.map((a) => ({ paymentId: payment.id, ...a })));
}

console.log(payment.id);
