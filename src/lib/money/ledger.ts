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
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, withTransaction } from "@/db";
import { violatedConstraint } from "@/db/errors";
import type { PaymentRail } from "@/db/schema";
import { charges, MONEY_CONSTRAINTS, paymentAllocations, payments } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor } from "@/lib/auth/scope";
import { listRosterForBoard } from "@/lib/auth/scope";

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
    if (!team.charges.some((charge) => charge.id === allocation.chargeId)) {
      return { ok: false, message: "That charge is not one of this team's open obligations." };
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

      for (const allocation of allocations) {
        // Counter first. See ordering (2) and (3) above.
        await tx
          .update(payments)
          .set({ allocatedCents: sql`${payments.allocatedCents} + ${allocation.amountCents}` })
          .where(eq(payments.id, payment.id));

        await tx.insert(paymentAllocations).values({
          paymentId: payment.id,
          chargeId: allocation.chargeId,
          amountCents: allocation.amountCents,
        });
      }

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
 * What a team has paid that is not attached to any particular obligation — the remainder of a lump
 * whose allocations do not use it all. Counted as paid, because it is: the money arrived.
 */
export const unappliedCreditFor = async (compId: string, teamId: string): Promise<number> => {
  const rows = await db
    .select({ gross: payments.grossCents, allocated: payments.allocatedCents })
    .from(payments)
    .where(and(eq(payments.compId, compId), eq(payments.teamId, teamId)));

  return rows.reduce((sum, row) => sum + (row.gross - row.allocated), 0);
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
