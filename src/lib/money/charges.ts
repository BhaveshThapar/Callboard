/**
 * The database half of A6, split from the pure `src/lib/fees/` the way `src/lib/comp/tab.ts` is
 * split from `src/lib/tabulation/`. Everything here reads or writes; every decision it acts on was
 * made by `generateCharges` and `planCharges`, which are pure and tested without a database.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Transaction } from "@/db";
import { db } from "@/db";
import { charges, feeSchedules } from "@/db/schema";
import type { BillableTeam, ChargePlan, ExistingCharge, FeeSchedule } from "@/lib/fees/types";
import { generateCharges, planCharges } from "@/lib/fees/schedule";
import { releaseAllocationsForCharges } from "./ledger";

type Writer = Transaction | typeof db;

/**
 * A comp's schedule, or null when it charges nothing.
 *
 * Read **before** the transaction opens, by every caller. It is comp-level and unchanging for the
 * duration of a roster move, so holding a WebSocket open across it buys nothing.
 */
export const feeScheduleFor = async (compId: string): Promise<FeeSchedule | null> => {
  const [row] = await db
    .select({
      perDancerCents: feeSchedules.perDancerCents,
      perRoomCents: feeSchedules.perRoomCents,
      depositCents: feeSchedules.depositCents,
      lateFeeCents: feeSchedules.lateFeeCents,
      lateAfter: feeSchedules.lateAfter,
    })
    .from(feeSchedules)
    .where(eq(feeSchedules.compId, compId))
    .limit(1);

  return row ?? null;
};

const liveChargesFor = async (
  writer: Writer,
  compId: string,
  teamIds: readonly string[],
): Promise<ExistingCharge[]> => {
  if (teamIds.length === 0) return [];
  return writer
    .select({
      id: charges.id,
      teamId: charges.teamId,
      kind: charges.kind,
      amountCents: charges.amountCents,
    })
    .from(charges)
    .where(
      and(
        eq(charges.compId, compId),
        inArray(charges.teamId, [...teamIds]),
        isNull(charges.voidedAt),
      ),
    );
};

/**
 * Brings a team's obligations in line with what the schedule says, and returns what it did.
 *
 * The decision is `planCharges`', which is pure: this only applies it. Voids come before inserts,
 * because a changed amount is a void plus an insert of the same `(team, kind)` and
 * `charges_live_kind_unique` is partial on `voided_at is null` — inserting first would collide with
 * the row about to be voided.
 *
 * `asOf` is passed in rather than read here, so the caller decides what day it is and the pure half
 * stays reproducible.
 */
export const syncCharges = async (
  writer: Writer,
  input: {
    compId: string;
    schedule: FeeSchedule;
    teams: readonly BillableTeam[];
    asOf: string;
    reason: string;
  },
): Promise<ChargePlan> => {
  const teamIds = input.teams.map((team) => team.teamId);
  const existing = await liveChargesFor(writer, input.compId, teamIds);

  const { lines } = generateCharges({
    schedule: input.schedule,
    teams: input.teams,
    asOf: input.asOf,
  });
  const plan = planCharges(lines, existing);

  if (plan.void.length > 0) {
    const voidedIds = plan.void.map((charge) => charge.id);

    // Before the charge disappears, let go of the money attached to it. An allocation left pointing
    // at a voided charge is money that reads as fully attributed and is attributed to nothing —
    // invisible to the who-owes screen, to the unattributed panel, and to `db:doctor`'s drift
    // check, which compares the counter against live allocations and finds them in agreement.
    await releaseAllocationsForCharges(writer, voidedIds);

    await writer
      .update(charges)
      .set({ voidedAt: new Date(), voidedReason: input.reason })
      .where(and(eq(charges.compId, input.compId), inArray(charges.id, voidedIds)));
  }

  if (plan.insert.length > 0) {
    await writer.insert(charges).values(
      plan.insert.map((line) => ({
        compId: input.compId,
        teamId: line.teamId,
        kind: line.kind,
        amountCents: line.amountCents,
      })),
    );
  }

  return plan;
};

/**
 * Voids every live charge a team holds. What a drop triggers.
 *
 * Deliberately not `syncCharges` with an empty team list: that would void nothing, because a team
 * absent from the input is a team whose charges were never loaded. The anti-orphan rule needs the
 * team named.
 */
export const voidChargesFor = async (
  writer: Writer,
  compId: string,
  teamId: string,
  reason: string,
): Promise<number> => {
  const live = await liveChargesFor(writer, compId, [teamId]);
  if (live.length === 0) return 0;

  // Same as `syncCharges`: the money lets go of the obligation before the obligation vanishes. This
  // is the drop-and-reinstate path, where the team's payment has to survive as findable credit.
  await releaseAllocationsForCharges(
    writer,
    live.map((charge) => charge.id),
  );

  await writer
    .update(charges)
    .set({ voidedAt: new Date(), voidedReason: reason })
    .where(
      and(
        eq(charges.compId, compId),
        eq(charges.teamId, teamId),
        isNull(charges.voidedAt),
      ),
    );

  return live.length;
};
