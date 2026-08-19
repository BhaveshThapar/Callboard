/**
 * A8 — recording money that arrived, and saying what it was for.
 *
 * This is the write [ADR-0012](../../../docs/decisions/0012-transactions-for-writes-that-span-statements.md)
 * exists for, and the **second sanctioned `withTransaction` caller** — named in advance by ADR-0012
 * so its arrival is a decision rather than a drift. The payment row, its allocations, and the
 * counter that constrains them are one act: half of it is a payment nobody can see the destination
 * of, or a counter claiming $2,160 is spent when nothing is. Both are states a human has to find and
 * repair, which is the problem being sold against.
 *
 * It said "second **and last**" until August 2, 2026, when a third earned the name on ADR-0012's own
 * terms: a deposit's ending and the money it returns ([ADR-0015](../../../docs/decisions/0015-a-refund-moves-the-money.md)).
 * Three functions here — `recordPayment`, `allocatePayment`, `releaseAllocation` — are all *this*
 * caller, because callers are counted by invariant rather than by call site.
 *
 * Nothing here routes money. Every row is hand-entered on a rail we record and do not move
 * (`PAYMENT_RAILS`), which is what lets the ledger close PRD §14's ~$5,000 gap without Stripe.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import { db, withTransaction } from "@/db";
import type { PaymentRail } from "@/db/schema";
import { charges, paymentAllocations, payments, teams } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor } from "@/lib/auth/scope";
import { listRosterForBoard } from "@/lib/auth/scope";
import { remainingOnCharge, unallocatedCents } from "./balance";
import { formatCents } from "./format";
import { refusalFor, UNKNOWN_REFUSAL } from "./refusals";

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
/**
 * The one insert that makes a `payments` row, shared by the treasurer's form and the Stripe webhook.
 *
 * Extracted so the claim "a webhook does not create a second way to write money" is enforced by
 * there being one function rather than asserted in a comment. `recordedByPersonId` is nullable here
 * and only here: a routed payment has no human who typed it, and the audit row says `system` rather
 * than borrowing somebody's name.
 */
const insertPayment = async (
  tx: Transaction,
  values: {
    compId: string;
    teamId: string;
    rail: PaymentRail;
    grossCents: number;
    feeCents: number;
    externalRef: string | null;
    recordedByPersonId: string | null;
  },
): Promise<string> => {
  const [payment] = await tx
    .insert(payments)
    .values({
      compId: values.compId,
      teamId: values.teamId,
      rail: values.rail,
      grossCents: values.grossCents,
      feeCents: values.feeCents,
      netCents: values.grossCents - values.feeCents,
      allocatedCents: 0,
      externalRef: values.externalRef,
      recordedByPersonId: values.recordedByPersonId,
    })
    .returning({ id: payments.id });

  if (!payment) throw new Error("payment insert returned no row");
  return payment.id;
};

/**
 * A5 — money that Stripe reports as settled, recorded by the same hand as everything else.
 *
 * **Not a second definition of a payment.** It writes through `insertPayment` below, the identical
 * insert the treasurer's form uses, so the allocation counter, `net = gross - fee`, and every
 * `MONEY_CONSTRAINTS` guarantee apply without being restated. A webhook with its own INSERT would be
 * a second answer to *what is a payment*, and the first divergence between them would be invisible.
 *
 * **Attributed to `system`, with no person, and that is honest rather than a gap.** `ACTOR_KINDS`
 * has carried `system` since the audit table existed. Attributing this to the board member who
 * connected the Stripe account would name somebody who did not record it; attributing it to nobody
 * at all is what `audit_log.actor_person_id` being nullable is for. *Every **board** action is
 * attributed* stays true — this is not a board action, and it must not be able to masquerade as one.
 *
 * **It allocates nothing**, and that is A8's own rule rather than a shortcut: money arriving before
 * anybody says what it is for is the ordinary case — a deposit lands while a team is still `applied`
 * — and `allocatePayment` exists precisely so attribution can happen afterwards.
 *
 * The caller must already have proven the team belongs to `compId`. The webhook does that against
 * the connected account rather than the event body, because the body is written by whoever created
 * the session and the account is what Stripe vouches for.
 */
export const recordRoutedPayment = async (input: {
  compId: string;
  teamId: string;
  grossCents: number;
  feeCents: number;
  rail: PaymentRail;
  externalRef: string;
}): Promise<LedgerResult> => {
  if (input.grossCents <= 0) return { ok: false, message: "A payment must be more than zero." };
  if (input.feeCents < 0) return { ok: false, message: "A processing fee cannot be negative." };

  try {
    return await withTransaction(async (tx) => {
      const paymentId = await insertPayment(tx, {
        compId: input.compId,
        teamId: input.teamId,
        rail: input.rail,
        grossCents: input.grossCents,
        feeCents: input.feeCents,
        externalRef: input.externalRef,
        recordedByPersonId: null,
      });

      await recordAudit(
        {
          compId: input.compId,
          actorKind: "system",
          actorPersonId: null,
          action: "payment.record",
          entity: "payment",
          entityId: paymentId,
          before: null,
          after: {
            teamId: input.teamId,
            rail: input.rail,
            grossCents: input.grossCents,
            feeCents: input.feeCents,
            allocatedCents: 0,
            via: "stripe",
          },
        },
        tx,
      );

      // Nothing attributed yet, so the whole amount is an unapplied credit -- which is exactly
      // what `allocatePayment` exists to resolve, and what the money screen shows as unattached.
      return { ok: true as const, paymentId, allocatedCents: 0, creditCents: input.grossCents };
    });
  } catch (error) {
    const refusal = refusalFor(error);
    return { ok: false, message: refusal ?? UNKNOWN_REFUSAL };
  }
};

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
      const paymentId = await insertPayment(tx, {
        compId: actor.compId,
        teamId: input.teamId,
        rail: input.rail,
        grossCents: input.grossCents,
        feeCents: input.feeCents,
        externalRef: input.externalRef ?? null,
        recordedByPersonId: actor.personId,
      });
      const payment = { id: paymentId };

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
    return { ok: false, message: refusalFor(error) ?? UNKNOWN_REFUSAL };
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
      refundedCents: payments.refundedCents,
    })
    .from(payments)
    .innerJoin(teams, eq(teams.id, payments.teamId))
    // `+ refunded_cents`, because refunding a deposit *releases* its allocations: the counter drops
    // back to zero while the gross stays, so `allocated < gross` would put a fully returned payment
    // on the to-do list and offer money that has left the account back for re-attribution.
    .where(
      and(
        eq(payments.compId, actor.compId),
        sql`${payments.allocatedCents} + ${payments.refundedCents} < ${payments.grossCents}`,
      ),
    )
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
      // Money that went back out is not money left to attribute. Without this the ceiling below
      // would let a refunded deposit be attached to a live obligation.
      refundedCents: payments.refundedCents,
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
    return { ok: false, message: refusalFor(error) ?? UNKNOWN_REFUSAL };
  }
};

/** One live allocation, as the thing a board can point at and take back. */
export type AllocationView = {
  id: string;
  chargeId: string;
  chargeKind: string;
  amountCents: number;
};

export type PaymentView = {
  id: string;
  teamId: string;
  teamName: string;
  bidCode: string;
  rail: PaymentRail;
  receivedAt: Date;
  grossCents: number;
  feeCents: number;
  netCents: number;
  allocatedCents: number;
  /** What has gone back out. `unallocatedCents` subtracts it: a refund is not re-attributable. */
  refundedCents: number;
  externalRef: string | null;
  reconciledAt: Date | null;
  /** Live only. A voided allocation is history and is not offered back for release. */
  allocations: AllocationView[];
};

/**
 * Every payment this comp has recorded — not only the ones with money left to attach — and what
 * each one was said to be for.
 *
 * `listOpenPayments` filters to `allocated < gross`, because its screen is a to-do list. This one
 * cannot reuse it: a reconciled payment is usually fully allocated, so the question *"which of these
 * have I matched against the bank statement"* is asked precisely about the rows that read filters
 * out. Two reads, two questions — and this one is still a read for a screen rather than a fourth
 * window, on `listOpenPayments`' own stated terms: comp scope comes from the `where`, and the only
 * id it hands back is a `paymentId`, which is not a `teamId` claim.
 *
 * **The allocations are carried for `releaseAllocation`'s sake**, and they are what makes an
 * `allocationId` on a form checkable: the array holds only this comp's live allocations, so another
 * comp's and an already-released one are refused by the same `find` — A3's argument one table over.
 * Unlike `listRosterForBoard`, which deliberately groups allocations to a per-charge sum because its
 * question is *how much of this obligation is settled*, this screen's question is *what did this
 * payment pay for, and can I take it back* — which is the one question the sum cannot answer.
 */
export const listPaymentsForBoard = async (actor: BoardActor): Promise<PaymentView[]> => {
  const [rows, allocations] = await Promise.all([
    db
      .select({
        id: payments.id,
        teamId: payments.teamId,
        teamName: teams.name,
        bidCode: teams.bidCode,
        rail: payments.rail,
        receivedAt: payments.receivedAt,
        grossCents: payments.grossCents,
        feeCents: payments.feeCents,
        netCents: payments.netCents,
        allocatedCents: payments.allocatedCents,
        refundedCents: payments.refundedCents,
        externalRef: payments.externalRef,
        reconciledAt: payments.reconciledAt,
      })
      .from(payments)
      .innerJoin(teams, eq(teams.id, payments.teamId))
      .where(eq(payments.compId, actor.compId))
      .orderBy(desc(payments.receivedAt)),

    db
      .select({
        id: paymentAllocations.id,
        paymentId: paymentAllocations.paymentId,
        chargeId: paymentAllocations.chargeId,
        chargeKind: charges.kind,
        amountCents: paymentAllocations.amountCents,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .innerJoin(charges, eq(charges.id, paymentAllocations.chargeId))
      .where(and(eq(payments.compId, actor.compId), isNull(paymentAllocations.voidedAt)))
      .orderBy(charges.kind),
  ]);

  const byPayment = new Map<string, AllocationView[]>();
  for (const { paymentId, ...allocation } of allocations) {
    byPayment.set(paymentId, [...(byPayment.get(paymentId) ?? []), allocation]);
  }

  return rows.map((row) => ({ ...row, allocations: byPayment.get(row.id) ?? [] }));
};

/**
 * Marks a payment as matched against the bank — or takes the mark back off.
 *
 * `payments.reconciled_at` was in the schema from migration `0009` and **nothing ever wrote it**. It
 * is the column PRD §13's *reconciliation error vs. bank: $0* is measured against, so a treasurer
 * could export the rows and match them by eye and had nowhere to record that they had: the second
 * pass across a season started from nothing, every time, which is how a $5,000 gap survives being
 * looked for.
 *
 * A timestamp rather than a boolean, for `waiver_accepted_at`'s reason: a boolean records a claim
 * and a timestamp records an event, and this is the column somebody would be asked to produce.
 *
 * Reversible on purpose, and it is the one thing here worth arguing. `deposit_events` refuses a
 * second ending because a deposit returned twice is money gone; a reconciliation mark moves no
 * money at all. It is a treasurer's own bookkeeping about a bank statement, and mis-ticking a row
 * you cannot un-tick would make the mark worth less, not more. Every flip is audited, which is where
 * the history lives — `payments` is not an append-only chain and does not become one for this.
 *
 * One statement, so no transaction (ADR-0012 stays about invariants that span two).
 */
export const setPaymentReconciled = async (
  actor: BoardActor,
  paymentId: string,
  reconciled: boolean,
): Promise<{ ok: true; reconciledAt: Date | null } | { ok: false; message: string }> => {
  const [payment] = await db
    .select({ id: payments.id, reconciledAt: payments.reconciledAt })
    .from(payments)
    // Comp scope comes from the where, exactly as `allocatePayment` takes it.
    .where(and(eq(payments.id, paymentId), eq(payments.compId, actor.compId)))
    .limit(1);

  if (!payment) return { ok: false, message: "That payment is not one of this comp's." };

  const reconciledAt = reconciled ? new Date() : null;

  await db.update(payments).set({ reconciledAt }).where(eq(payments.id, payment.id));

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: reconciled ? "payment.reconcile" : "payment.unreconcile",
    entity: "payment",
    entityId: payment.id,
    before: { reconciledAt: payment.reconciledAt },
    after: { reconciledAt },
  });

  return { ok: true, reconciledAt };
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
 * Voids one allocation and returns its cents to the payment's unapplied credit.
 *
 * **This is the undo for a wrong label, and for three weeks there was none.** The function existed,
 * complete and transactional, with no server action and no UI behind it — so a treasurer who typed
 * $560 against the deposit instead of the hotel could not take it back. `payment_allocations_live_unique`
 * makes the mistake permanent on a second attempt, and `recordPayment`'s own ceiling message says
 * *"reload and adjust the existing allocation instead"*, which named an instrument that did not
 * exist. The only escape was a roster move that voided the whole charge.
 *
 * **This changes no balance**, exactly as `releaseAllocationsForCharges` does not: `paid` is the sum
 * of gross, so releasing moves money from *attached to this obligation* to *unattached*, and the
 * who-owes total does not move. What changes is that the money becomes re-attributable — which is
 * the same sentence as A8's lump, arriving from the other direction.
 *
 * Append-only in spirit: the row survives with `voided_at` set, because deleting it would destroy
 * the record of what somebody believed the money was for. The counter moves down by the same atomic
 * increment that moved it up, so `db:doctor`'s drift check stays quiet.
 *
 * The `allocationId` resolves through `listPaymentsForBoard` — the read that produced the form —
 * rather than through a `where` of its own. That is `advanceDeposit`'s pattern and the window rule's
 * literal sentence: comp scope and *is live* both come free from that read, so another comp's
 * allocation and an already-released one are refused by the same `find`, with no second definition
 * of which allocations count.
 */
export const releaseAllocation = async (
  actor: BoardActor,
  allocationId: string,
): Promise<LedgerResult> => {
  const payments_ = await listPaymentsForBoard(actor);
  const payment = payments_.find((row) => row.allocations.some((a) => a.id === allocationId));
  const allocation = payment?.allocations.find((a) => a.id === allocationId);

  if (!payment || !allocation) {
    return { ok: false, message: "That allocation is not one of this comp's, or is already released." };
  }

  try {
    return await withTransaction(async (tx) => {
      /**
       * **Void first here, and counter first everywhere else, and the asymmetry is the point.**
       *
       * On the way up the counter carries the constraint, so moving it first is what makes
       * `allocated <= gross` fire on a race (ADR-0014). On the way down that CHECK protects nothing
       * — `>= 0` only catches a decrement that crosses zero — so a counter-first release lets two
       * clicks subtract the same cents twice and leaves the counter permanently under the sum it
       * stands for. Exactly the drift `db:doctor` reports and nobody can resolve.
       *
       * So the guarded void is the serialization point: it takes the allocation's own row lock, and
       * `returning` says whether *this* statement is the one that voided it. A loser voids nothing,
       * decrements nothing, and is told so.
       */
      const voided = await tx
        .update(paymentAllocations)
        .set({ voidedAt: new Date() })
        .where(and(eq(paymentAllocations.id, allocationId), isNull(paymentAllocations.voidedAt)))
        .returning({ id: paymentAllocations.id });

      if (voided.length === 0) {
        return {
          ok: false as const,
          message: "Somebody else already released that. The money is unattached, not released twice.",
        };
      }

      await tx
        .update(payments)
        .set({ allocatedCents: sql`${payments.allocatedCents} - ${allocation.amountCents}` })
        .where(eq(payments.id, payment.id));

      await recordAudit(
        {
          compId: actor.compId,
          actorKind: "board",
          actorPersonId: actor.personId,
          action: "allocation.release",
          entity: "payment",
          entityId: payment.id,
          before: { allocationId, chargeId: allocation.chargeId, amountCents: allocation.amountCents },
          after: null,
        },
        tx,
      );

      return {
        ok: true as const,
        paymentId: payment.id,
        // What this act allocated, which is nothing — the shape `allocatePayment` returns, read the
        // same way. The credit is the number a treasurer is actually told about.
        allocatedCents: 0,
        creditCents: allocation.amountCents,
      };
    });
  } catch (error) {
    return { ok: false, message: refusalFor(error) ?? UNKNOWN_REFUSAL };
  }
};
