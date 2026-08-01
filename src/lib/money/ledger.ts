/**
 * A8 — recording money that arrived, and saying what it was for.
 *
 * This is the write [ADR-0012](../../../docs/decisions/0012-transactions-for-writes-that-span-statements.md)
 * exists for, and the **second and last sanctioned `withTransaction` caller** — named in advance by
 * ADR-0012 so its arrival is a decision rather than a drift. The payment row, its allocations, and
 * the counter that constrains them are one act: half of it is a payment nobody can see the
 * destination of, or a counter claiming $2,160 is spent when nothing is. Both are states a human
 * has to find and repair, which is the problem being sold against.
 *
 * Nothing here routes money. Every row is hand-entered on a rail we record and do not move
 * (`PAYMENT_RAILS`), which is what lets the ledger close PRD §14's ~$5,000 gap without Stripe.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import { db, withTransaction } from "@/db";
import { violatedConstraint } from "@/db/errors";
import type { PaymentRail } from "@/db/schema";
import { charges, MONEY_CONSTRAINTS, paymentAllocations, payments, teams } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor } from "@/lib/auth/scope";
import { listRosterForBoard } from "@/lib/auth/scope";
import { remainingOnCharge, unallocatedCents } from "./balance";
import { formatCents } from "./format";

export type PaymentInput = {
  teamId: string;
  rail: PaymentRail;
  grossCents: number;
  feeCents: number;
  /** Optional bank/processor reference. Unique per comp where present, so a re-import is refused. */
  externalRef?: string;
  /** `chargeId -> cents`. May be empty: an unallocated payment is a credit, not an error. */
  allocations: readonly { chargeId: string; amountCents: number }[];
};

export type LedgerResult =
  | { ok: true; paymentId: string; allocatedCents: number; creditCents: number }
  | { ok: false; message: string };

/**
 * A database refusal, as a sentence a treasurer can act on.
 *
 * The **third** reader of `violatedConstraint`, and it means a third thing by it: `lockAction` reads
 * a chain index as a *refusal* (there must not be a second root), `apply` reads the bid-code unique
 * as a *retry* (the applicant did nothing wrong), and this reads a money constraint as *an
 * explanation*. What all three share is that none may guess from the message text — drizzle's own
 * `message` is the failed SQL, and `Failed query: insert into "payments" ...` is not a thing to show
 * someone reconciling a bank statement.
 */
const refusal = (error: unknown): string | null => {
  switch (violatedConstraint(error)) {
    case MONEY_CONSTRAINTS.allocatedCeiling:
      return "That would allocate more than this payment is worth. Someone may have allocated part of it already — reload and check what is left.";
    case MONEY_CONSTRAINTS.netIdentity:
      return "The net does not equal gross minus fee. Enter what the bank actually shows rather than a rounded figure.";
    case MONEY_CONSTRAINTS.externalRef:
      return "A payment with that reference is already recorded for this comp. It has not been recorded twice.";
    case MONEY_CONSTRAINTS.liveAllocation:
      return "Part of this payment is already applied to that charge. Reload and adjust the existing allocation instead.";
    default:
      return null;
  }
};

const UNKNOWN = "Could not record that payment. Nothing was saved — reload and try again.";

/**
 * The counter, then the row. Extracted so the ordering [ADR-0014] cares about has **one**
 * definition — `recordPayment` and `allocatePayment` both go through here, and a future third
 * caller cannot get it backwards by writing the pair out again.
 *
 * The counter moves by `allocated_cents + $n`, never by a total computed in JS: reading, adding and
 * writing back is two acts another allocator can land between, whereas this is one atomic
 * read-modify-write holding its own row lock. And it moves *first*, because that decides which
 * constraint fires on a race — `payments_allocated_check` is the one whose sentence says something
 * true about what happened.
 */
const applyAllocations = async (
  tx: Transaction,
  paymentId: string,
  allocations: readonly { chargeId: string; amountCents: number }[],
): Promise<void> => {
  for (const allocation of allocations) {
    await tx
      .update(payments)
      .set({ allocatedCents: sql`${payments.allocatedCents} + ${allocation.amountCents}` })
      .where(eq(payments.id, paymentId));

    await tx.insert(paymentAllocations).values({
      paymentId,
      chargeId: allocation.chargeId,
      amountCents: allocation.amountCents,
    });
  }
};

/**
 * Records money and what it settled, in one act.
 *
 * Three orderings here are load-bearing and were each got wrong once in design:
 *
 * 1. **Claims are checked before the pool opens.** A WebSocket handshake is expensive and a rejected
 *    form must not pay for one. `teamId` and every `chargeId` resolve against `listRosterForBoard`,
 *    the read that produced the screen the form came from — a `chargeId` resolves one level down it,
 *    which is stronger than a WHERE clause because the array holds only this comp's, this team's,
 *    *live* charges.
 * 2. **The counter moves before the allocation insert.** Which constraint fires on a race decides
 *    which sentence the treasurer reads, and `payments_allocated_check` is the one that says
 *    something true about what happened.
 * 3. **The counter moves by `allocated_cents + $n`, never by a computed total.** Reading, adding in
 *    JS, and writing back is two acts across which another allocator can land; this is one atomic
 *    read-modify-write holding its own row lock. That is [ADR-0014] entire.
 */
export const recordPayment = async (
  actor: BoardActor,
  input: PaymentInput,
): Promise<LedgerResult> => {
  if (input.grossCents <= 0) return { ok: false, message: "A payment must be more than zero." };
  if (input.feeCents < 0) return { ok: false, message: "A processing fee cannot be negative." };

  const roster = await listRosterForBoard(actor);
  const team = roster.find((row) => row.id === input.teamId);
  if (!team) return { ok: false, message: "That team is not in this comp." };

  const allocations = input.allocations.filter((a) => a.amountCents !== 0);
  for (const allocation of allocations) {
    if (allocation.amountCents < 0) {
      return { ok: false, message: "An allocation cannot be negative. Record a refund instead." };
    }
    // The chargeId claim, resolved one level down the read that produced the form.
    const charge = team.charges.find((row) => row.id === allocation.chargeId);
    if (!charge) {
      return { ok: false, message: "That charge is not one of this team's open obligations." };
    }
    // A fat-finger refusal, and deliberately **not** a constraint. Over-settling one obligation
    // while under-settling another does not move `paid` — that is gross-based — so this is an
    // attribution error, not a balance error, and making the database enforce it would mean a
    // second denormalized counter on `charges`: ADR-0014's bargain paid twice for a wrong label
    // rather than a wrong number. It sits here because here is where a typed digit arrives.
    const remaining = remainingOnCharge(charge);
    if (allocation.amountCents > remaining) {
      return {
        ok: false,
        message: `${formatCents(allocation.amountCents)} is more than is left on that ${charge.kind} charge (${formatCents(remaining)}).`,
      };
    }
  }

  const allocatedCents = allocations.reduce((sum, a) => sum + a.amountCents, 0);
  if (allocatedCents > input.grossCents) {
    return { ok: false, message: "Those allocations come to more than the payment." };
  }

  try {
    return await withTransaction(async (tx) => {
      const [payment] = await tx
        .insert(payments)
        .values({
          compId: actor.compId,
          teamId: input.teamId,
          rail: input.rail,
          grossCents: input.grossCents,
          feeCents: input.feeCents,
          netCents: input.grossCents - input.feeCents,
          allocatedCents: 0,
          externalRef: input.externalRef ?? null,
          recordedByPersonId: actor.personId,
        })
        .returning({ id: payments.id });

      if (!payment) throw new Error("payment insert returned no row");

      await applyAllocations(tx, payment.id, allocations);

      await recordAudit(
        {
          compId: actor.compId,
          actorKind: "board",
          actorPersonId: actor.personId,
          action: "payment.record",
          entity: "payment",
          entityId: payment.id,
          before: null,
          after: {
            teamId: input.teamId,
            rail: input.rail,
            grossCents: input.grossCents,
            feeCents: input.feeCents,
            allocatedCents,
          },
        },
        tx,
      );

      return {
        ok: true as const,
        paymentId: payment.id,
        allocatedCents,
        creditCents: input.grossCents - allocatedCents,
      };
    });
  } catch (error) {
    return { ok: false, message: refusal(error) ?? UNKNOWN };
  }
};

/**
 * Money that arrived and is not attached to any obligation, worst first.
 *
 * This replaces a per-team `unappliedCreditFor` that had no caller anywhere. Keeping both would be
 * two definitions of "unapplied credit", which is the thing `remainingOnCharge` and
 * `unallocatedCents` exist to prevent one directory over.
 *
 * Comp-scoped off the actor, and every `chargeId` the panel then offers comes from
 * `listRosterForBoard` — so this is a read for a screen, not a fourth window.
 */
export type OpenPayment = {
  id: string;
  teamId: string;
  teamName: string;
  bidCode: string;
  rail: PaymentRail;
  receivedAt: Date;
  grossCents: number;
  allocatedCents: number;
  remainingCents: number;
};

export const listOpenPayments = async (actor: BoardActor): Promise<OpenPayment[]> => {
  const rows = await db
    .select({
      id: payments.id,
      teamId: payments.teamId,
      teamName: teams.name,
      bidCode: teams.bidCode,
      rail: payments.rail,
      receivedAt: payments.receivedAt,
      grossCents: payments.grossCents,
      allocatedCents: payments.allocatedCents,
    })
    .from(payments)
    .innerJoin(teams, eq(teams.id, payments.teamId))
    .where(and(eq(payments.compId, actor.compId), sql`${payments.allocatedCents} < ${payments.grossCents}`))
    .orderBy(desc(payments.receivedAt));

  return rows.map((row) => ({
    ...row,
    remainingCents: unallocatedCents(row),
  }));
};

/**
 * Attaches an existing payment's remainder to obligations that exist now.
 *
 * The gap this closes is not cosmetic and does not go away once a form exists. `recordPayment`
 * consumes its allocations inside the transaction that creates the payment, so the set was fixed at
 * insert and permanent — and two ordinary sequences put money where it could never be attributed:
 * a team pays a deposit to hold a slot while still `applied`, so `BILLABLE_STATUSES` means it has no
 * charges and every allocation is refused; or a roster size changes later and `syncCharges` voids
 * and re-inserts, leaving the allocation pointing at a row nobody can see. NCSU's $2,160 labelled
 * "hotel, security deposit & reg fees" is the first case, and it is PRD §14's headline exhibit.
 *
 * **This is not a third `withTransaction` caller.** ADR-0012 names the unit as *the ledger* — "a
 * payment row, its allocations and the counter that constrains them are one act" — and this writes
 * exactly that invariant and no other. The broken half is a counter claiming money is spent against
 * nothing, or an allocation with no counter behind it, which is precisely the drift `db:doctor`
 * reports by id. Same module, same invariant, same two statements.
 */
export const allocatePayment = async (
  actor: BoardActor,
  paymentId: string,
  allocations: readonly { chargeId: string; amountCents: number }[],
): Promise<LedgerResult> => {
  // Everything resolves before the pool opens: a refused form must not pay for a handshake.
  const [payment] = await db
    .select({
      id: payments.id,
      teamId: payments.teamId,
      grossCents: payments.grossCents,
      allocatedCents: payments.allocatedCents,
    })
    .from(payments)
    // Comp scope comes from the where, not from a second definition of it.
    .where(and(eq(payments.id, paymentId), eq(payments.compId, actor.compId)))
    .limit(1);

  if (!payment) return { ok: false, message: "That payment is not one of this comp's." };

  const wanted = allocations.filter((a) => a.amountCents !== 0);
  if (wanted.length === 0) return { ok: false, message: "Enter what this money settles." };

  // The team comes from the payment row, which is already comp-scoped — not from the form. So a
  // `paymentId` is not a second `teamId` claim, and the `chargeId` below still resolves one level
  // down `listRosterForBoard`, which is the rule A3 established rather than a fourth window.
  const roster = await listRosterForBoard(actor);
  const team = roster.find((row) => row.id === payment.teamId);
  if (!team) return { ok: false, message: "That payment's team is no longer in this comp." };

  for (const allocation of wanted) {
    if (allocation.amountCents < 0) {
      return { ok: false, message: "An allocation cannot be negative. Record a refund instead." };
    }
    const charge = team.charges.find((row) => row.id === allocation.chargeId);
    if (!charge) {
      return { ok: false, message: "That charge is not one of this team's open obligations." };
    }
    const remaining = remainingOnCharge(charge);
    if (allocation.amountCents > remaining) {
      return {
        ok: false,
        message: `${formatCents(allocation.amountCents)} is more than is left on that ${charge.kind} charge (${formatCents(remaining)}).`,
      };
    }
  }

  const total = wanted.reduce((sum, a) => sum + a.amountCents, 0);
  const available = unallocatedCents(payment);
  if (total > available) {
    return {
      ok: false,
      message: `That is more than is left of this payment (${formatCents(available)}).`,
    };
  }

  try {
    return await withTransaction(async (tx) => {
      await applyAllocations(tx, payment.id, wanted);

      await recordAudit(
        {
          compId: actor.compId,
          actorKind: "board",
          actorPersonId: actor.personId,
          action: "allocation.apply",
          entity: "payment",
          entityId: payment.id,
          before: { allocatedCents: payment.allocatedCents },
          after: { allocatedCents: payment.allocatedCents + total, allocations: wanted },
        },
        tx,
      );

      return {
        ok: true as const,
        paymentId: payment.id,
        allocatedCents: total,
        creditCents: available - total,
      };
    });
  } catch (error) {
    return { ok: false, message: refusal(error) ?? UNKNOWN };
  }
};

/**
 * Releases every live allocation pointing at charges that are being voided, in the caller's own act.
 *
 * The quiet half of the attribution problem, and it fires on the most common event of a
 * registration season. `syncCharges` voids and re-inserts whenever an amount changes and
 * `voidChargesFor` voids everything on a drop — and the allocation rows stayed live, pointing at
 * rows nobody can see. Nothing caught it: `db:doctor`'s drift query compares `allocated_cents` to
 * the sum of live *allocations*, and those still agreed perfectly. The money read as fully
 * attributed and was attributed to nothing, `unallocatedCents` reported 0 for it, and the
 * unattributed-credit panel could not find it either.
 *
 * **This changes no balance.** `paid` is the sum of gross, so a release moves money from "attached
 * to a dead obligation" to "unattached", and the who-owes totals do not move. What changes is that
 * the money becomes findable again.
 *
 * Takes the caller's `Writer` rather than opening its own transaction, so it composes inside
 * `setTeamStatus`'s existing one — the same invariant ADR-0012 already justified, with one more
 * statement inside it. It is **not** a new `withTransaction` caller.
 */
export const releaseAllocationsForCharges = async (
  writer: Transaction | typeof db,
  chargeIds: readonly string[],
): Promise<number> => {
  if (chargeIds.length === 0) return 0;

  const live = await writer
    .select({
      id: paymentAllocations.id,
      paymentId: paymentAllocations.paymentId,
      amountCents: paymentAllocations.amountCents,
    })
    .from(paymentAllocations)
    .where(
      and(
        inArray(paymentAllocations.chargeId, [...chargeIds]),
        isNull(paymentAllocations.voidedAt),
      ),
    );

  if (live.length === 0) return 0;

  await writer
    .update(paymentAllocations)
    .set({ voidedAt: new Date() })
    .where(
      and(
        inArray(
          paymentAllocations.id,
          live.map((row) => row.id),
        ),
        isNull(paymentAllocations.voidedAt),
      ),
    );

  // One statement per payment rather than per allocation, and by the same atomic increment that
  // moved the counter up — so `allocated = sum(live allocations)` stays true and the doctor stays
  // quiet, which is the whole point of doing this rather than leaving the rows behind.
  const byPayment = new Map<string, number>();
  for (const row of live) {
    byPayment.set(row.paymentId, (byPayment.get(row.paymentId) ?? 0) + row.amountCents);
  }

  for (const [paymentId, released] of byPayment) {
    await writer
      .update(payments)
      .set({ allocatedCents: sql`${payments.allocatedCents} - ${released}` })
      .where(eq(payments.id, paymentId));
  }

  return live.length;
};

/**
 * Voids an allocation and returns the cents to the payment's unapplied credit.
 *
 * Append-only in spirit: the allocation row survives with `voided_at` set, because deleting it would
 * destroy the record of what somebody believed the money was for. The counter moves down by the same
 * atomic increment that moved it up.
 */
export const releaseAllocation = async (
  actor: BoardActor,
  allocationId: string,
): Promise<LedgerResult> => {
  const [row] = await db
    .select({
      id: paymentAllocations.id,
      paymentId: paymentAllocations.paymentId,
      amountCents: paymentAllocations.amountCents,
      grossCents: payments.grossCents,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(charges, eq(charges.id, paymentAllocations.chargeId))
    // Comp scope comes from the join, not from a second definition of it.
    .where(
      and(
        eq(paymentAllocations.id, allocationId),
        eq(payments.compId, actor.compId),
        isNull(paymentAllocations.voidedAt),
      ),
    )
    .limit(1);

  if (!row) return { ok: false, message: "That allocation is not one of this comp's." };

  try {
    return await withTransaction(async (tx) => {
      await tx
        .update(paymentAllocations)
        .set({ voidedAt: new Date() })
        .where(eq(paymentAllocations.id, allocationId));

      await tx
        .update(payments)
        .set({ allocatedCents: sql`${payments.allocatedCents} - ${row.amountCents}` })
        .where(eq(payments.id, row.paymentId));

      await recordAudit(
        {
          compId: actor.compId,
          actorKind: "board",
          actorPersonId: actor.personId,
          action: "allocation.release",
          entity: "payment",
          entityId: row.paymentId,
          before: { allocationId, amountCents: row.amountCents },
          after: null,
        },
        tx,
      );

      return {
        ok: true as const,
        paymentId: row.paymentId,
        allocatedCents: 0,
        creditCents: row.amountCents,
      };
    });
  } catch (error) {
    return { ok: false, message: refusal(error) ?? UNKNOWN };
  }
};
