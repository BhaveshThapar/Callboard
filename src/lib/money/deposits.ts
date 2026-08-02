/**
 * The database half of A7, split from the pure machine in `./deposit` the way `charges.ts` is split
 * from `src/lib/fees/`.
 *
 * Two shapes of write live here, and the difference is the whole design. A move that only *states*
 * where a deposit stands — `held → refund_pending`, a bounced return going back to `held` — is one
 * INSERT plus one audit row and stays on `db`, because what must not happen twice is refused by
 * `deposit_events_terminal_unique` rather than by a transaction. A move that **ends** the deposit by
 * returning the money is a different act: the ending and the money have to land together, and that
 * is the third `withTransaction` caller, argued for in ADR-0012's own terms.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, withTransaction } from "@/db";
import { violatedConstraint } from "@/db/errors";
import {
  charges,
  depositEvents,
  MONEY_CONSTRAINTS,
  paymentAllocations,
  payments,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor } from "@/lib/auth/scope";
import { listRosterForBoard } from "@/lib/auth/scope";
import type { DepositState } from "./deposit";
import { allowedFrom, canTransition, currentState, isTerminal } from "./deposit";
import { formatCents } from "./format";
import { releaseAllocationsForCharges } from "./ledger";

export type DepositView = {
  teamId: string;
  teamName: string;
  bidCode: string;
  /**
   * The charge carrying this deposit — the live one, or the most recent voided one when there is
   * none. Provenance for the money, which is why it survives a drop; `settled` is what says whether
   * it is still owed.
   */
  chargeId: string | null;
  amountCents: number;
  /**
   * What actually arrived against that charge, **live allocations or voided ones**. A dropped team's
   * allocations are released by `voidChargesFor` precisely so the money stays findable, so counting
   * only live ones would report $0 paid for every deposit a board most needs to decide about — and
   * then refuse to return money that is sitting in the org's account.
   */
  paidCents: number;
  state: DepositState;
  canMoveTo: readonly DepositState[];
  /** True once the obligation is gone — a dropped team, or a returned deposit. */
  settled: boolean;
};

export type DepositResult = { ok: true; state: DepositState } | { ok: false; message: string };

/**
 * Every deposit in the comp, live or ended, with the state its chain is in.
 *
 * Built over `listRosterForBoard`, so a `teamId` here is already resolved against the window that
 * produced it — the same one level down `find` A3 established, and not a fourth window.
 *
 * **It deliberately does not filter to live charges, and that is a fix rather than a relaxation.**
 * It used to read `team.charges`, which the roster window filters to `voided_at is null`. Dropping a
 * team voids every charge it holds, so the deposit row vanished from the screen at exactly the
 * moment the question *forfeit or refund?* gets asked, and `advanceDeposit` answered "that deposit
 * is not one of this comp's". A dropped team's deposit is the most consequential one in the comp.
 */
export const listDepositsForBoard = async (actor: BoardActor): Promise<DepositView[]> => {
  const roster = await listRosterForBoard(actor);
  if (roster.length === 0) return [];

  const teamIds = roster.map((team) => team.id);

  const [depositCharges, events, paid] = await Promise.all([
    // Voided ones included, newest first, so a dropped team keeps its deposit and a regenerated
    // charge does not orphan the one before it. Comp scope comes from this `where`.
    db
      .select({
        id: charges.id,
        teamId: charges.teamId,
        amountCents: charges.amountCents,
        voidedAt: charges.voidedAt,
      })
      .from(charges)
      .where(
        and(
          eq(charges.compId, actor.compId),
          eq(charges.kind, "deposit"),
          inArray(charges.teamId, teamIds),
        ),
      )
      .orderBy(desc(charges.createdAt)),

    db
      .select({ teamId: depositEvents.teamId, seq: depositEvents.seq, state: depositEvents.state })
      .from(depositEvents)
      .where(eq(depositEvents.compId, actor.compId)),

    /**
     * Grouped by *charge* rather than by team, so a deposit that was refunded, regenerated and paid
     * again reports what arrived against the charge it is carried by now — not that sum plus the
     * one before it.
     *
     * Both sums, because which one is true depends on why the allocations are voided, and that is
     * knowable from the charge rather than from the allocation. On a **live** charge a voided
     * allocation was released by a board correcting a wrong label, and its money was re-attached
     * somewhere — counting it would double what the team paid. On a **voided** charge every
     * allocation was released by the void itself, so the live sum is 0 and the total is what
     * arrived. Taking the total unconditionally makes a released-and-reallocated deposit read
     * double, which `payments_refunded_check` would then refuse — a refusal in place of a refund.
     */
    db
      .select({
        chargeId: paymentAllocations.chargeId,
        livePaidCents: sql<string>`coalesce(sum(${paymentAllocations.amountCents}) filter (where ${paymentAllocations.voidedAt} is null), 0)`,
        everPaidCents: sql<string>`coalesce(sum(${paymentAllocations.amountCents}), 0)`,
      })
      .from(paymentAllocations)
      .innerJoin(charges, eq(charges.id, paymentAllocations.chargeId))
      .where(and(eq(charges.compId, actor.compId), eq(charges.kind, "deposit")))
      .groupBy(paymentAllocations.chargeId),
  ]);

  const byTeam = new Map<string, { seq: number; state: DepositState }[]>();
  for (const event of events) {
    byTeam.set(event.teamId, [...(byTeam.get(event.teamId) ?? []), event]);
  }

  const paidByCharge = new Map(
    paid.map((row) => [
      row.chargeId,
      { live: Number(row.livePaidCents), ever: Number(row.everPaidCents) },
    ]),
  );

  return roster.flatMap((team) => {
    const forTeam = depositCharges.filter((charge) => charge.teamId === team.id);
    const live = forTeam.find((charge) => charge.voidedAt === null);
    const carrier = live ?? forTeam[0];
    const chain = byTeam.get(team.id) ?? [];

    // No deposit charge and no history means this comp does not take one from this team.
    if (!carrier && chain.length === 0) return [];

    const sums = carrier ? paidByCharge.get(carrier.id) : undefined;
    const state = currentState(chain);
    return [
      {
        teamId: team.id,
        teamName: team.name,
        bidCode: team.bidCode,
        chargeId: carrier?.id ?? null,
        amountCents: carrier?.amountCents ?? 0,
        paidCents: (live ? sums?.live : sums?.ever) ?? 0,
        state,
        canMoveTo: allowedFrom(state),
        settled: live === undefined,
      },
    ];
  });
};

/** Whether this transition is the one where money actually leaves the org's account. */
const returnsMoney = (to: DepositState): boolean => to === "refunded";

/**
 * Appends one transition, and moves the money when the transition is the one that moves money.
 *
 * The `teamId` is a claim and resolves through `listDepositsForBoard`, which is `listRosterForBoard`
 * with the deposit chain attached — comp scope comes free from that read's own `where`, exactly as
 * the window rule requires.
 *
 * A refused transition and a refused *second ending* are different failures and say different
 * things: the first is a board asking for something the machine does not permit, the second is a
 * board clicking twice. Only the second reaches the database.
 *
 * **`refunded` voids the obligation and gives the money back; `forfeited` does neither.** That
 * asymmetry is the model (ADR-0015). A forfeited deposit is money the org keeps against an
 * obligation the team owed, so every number is already right and touching any of them would be
 * wrong. A refunded one is money that left the building: the charge stops being owed, its
 * allocations are released, and `payments.refunded_cents` records the outflow — so `owed` and `paid`
 * fall by the same amount, the balance does not move, and the books finally agree with the bank.
 * Until this existed a returned deposit changed no number at all.
 */
export const advanceDeposit = async (
  actor: BoardActor,
  teamId: string,
  to: DepositState,
  reason: string | null,
): Promise<DepositResult> => {
  const deposits = await listDepositsForBoard(actor);
  const deposit = deposits.find((row) => row.teamId === teamId);
  if (!deposit) return { ok: false, message: "That deposit is not one of this comp's." };

  if (isTerminal(deposit.state)) {
    return {
      ok: false,
      message: `That deposit was already ${deposit.state}. A deposit ends once.`,
    };
  }

  if (!canTransition(deposit.state, to)) {
    return {
      ok: false,
      message: `A deposit that is ${deposit.state} cannot become ${to}.`,
    };
  }

  // A deposit nobody paid cannot be returned, and the refusal belongs at the start of the refund
  // rather than at its end: a board that reaches `refunded` has already told a team the money is
  // coming. `forfeited` is deliberately exempt — forfeiting an unpaid deposit is a real thing to
  // record, and it is how a board says *this slot was held and never paid for*.
  if ((to === "refund_pending" || to === "refunded") && deposit.paidCents === 0) {
    return {
      ok: false,
      message: "Nothing has been paid against that deposit, so there is nothing to return.",
    };
  }

  const event = {
    compId: actor.compId,
    teamId,
    chargeId: deposit.chargeId,
    state: to,
    reason,
    createdByPersonId: actor.personId,
  };

  const audit = {
    compId: actor.compId,
    actorKind: "board" as const,
    actorPersonId: actor.personId,
    action: "deposit.transition",
    entity: "team",
    entityId: teamId,
    before: { state: deposit.state },
    after: { state: to, reason, refundedCents: returnsMoney(to) ? deposit.paidCents : 0 },
  };

  try {
    if (!returnsMoney(to)) {
      await db.insert(depositEvents).values(event);
      await recordAudit(audit);
      return { ok: true, state: to };
    }

    /**
     * The third `withTransaction` caller, and ADR-0012 asks for the argument to be made again
     * rather than inherited. The invariant is **a deposit's ending and the money it returns land
     * together**, and it genuinely spans statements: the event, the void, the released allocations
     * and the counter are four. Its broken halves are both states a human has to find — a deposit
     * marked `refunded` while the team still reads as owing it, or an obligation quietly voided
     * with no record of anyone deciding to return anything.
     *
     * The non-terminal moves above keep their single statement, for the reason `setTeamStatus`'s
     * fast path used to exist: a transaction costs a WebSocket handshake, and *this deposit is now
     * pending* implies nothing else.
     */
    await withTransaction(async (tx) => {
      await tx.insert(depositEvents).values(event);

      /**
       * Which payments the deposit money arrived on — **read before anything releases them**, or
       * this query comes back empty and the refund silently returns nothing.
       *
       * `voided_at` is filtered by the same rule that produced `paidCents`, and it has to be the
       * same rule or the two disagree about how much is going back: on a live charge only live
       * allocations count, because a voided one was released by a correction and its money went
       * elsewhere; on an already-voided charge every allocation counts, because the void released
       * them all and that is exactly the dropped team this change exists to reach.
       */
      const sources = await tx
        .select({ paymentId: payments.id, amountCents: paymentAllocations.amountCents })
        .from(paymentAllocations)
        .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
        .where(
          and(
            eq(paymentAllocations.chargeId, deposit.chargeId ?? ""),
            deposit.settled ? undefined : isNull(paymentAllocations.voidedAt),
          ),
        );

      if (!deposit.settled && deposit.chargeId) {
        // Money lets go of the obligation before the obligation goes, exactly as `syncCharges` and
        // `voidChargesFor` do — an allocation left pointing at a voided charge is money that reads
        // as fully attributed and is attributed to nothing.
        await releaseAllocationsForCharges(tx, [deposit.chargeId]);
        await tx
          .update(charges)
          .set({ voidedAt: new Date(), voidedReason: "deposit refunded" })
          .where(and(eq(charges.id, deposit.chargeId), isNull(charges.voidedAt)));
      }

      // What arrived against the deposit is what goes back, spread over the payments it arrived on.
      // `refunded_cents` rather than a negative row, because negative gross would make the
      // allocation ceiling uninterpretable — which is the whole of ADR-0014.
      let outstanding = deposit.paidCents;
      for (const source of sources) {
        if (outstanding <= 0) break;
        const give = Math.min(outstanding, source.amountCents);
        await tx
          .update(payments)
          .set({ refundedCents: sql`${payments.refundedCents} + ${give}` })
          .where(eq(payments.id, source.paymentId));
        outstanding -= give;
      }

      await recordAudit(audit, tx);
    });
  } catch (error) {
    if (violatedConstraint(error) === MONEY_CONSTRAINTS.depositTerminal) {
      // The realistic case: two clicks, or two board members, landing between the read above and
      // this insert. Neither did anything wrong, and the money moved once.
      return {
        ok: false,
        message: "Somebody else already closed that deposit. It has not been returned twice.",
      };
    }
    if (violatedConstraint(error) === MONEY_CONSTRAINTS.refundedCeiling) {
      return {
        ok: false,
        message: `That would return more than ${formatCents(deposit.paidCents)} ever arrived.`,
      };
    }
    return { ok: false, message: "Could not record that. Nothing was saved — reload and try again." };
  }

  return { ok: true, state: to };
};
