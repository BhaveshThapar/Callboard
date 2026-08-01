/**
 * The database half of A7, split from the pure machine in `./deposit` the way `charges.ts` is split
 * from `src/lib/fees/`.
 *
 * One INSERT plus one audit row, so this stays on `db` and opens no transaction. That is not an
 * oversight: there is no invariant here spanning two statements. What must not happen twice — a
 * deposit ending twice — is refused by `deposit_events_terminal_unique`, and an index refuses a
 * second ending from a hand-typed `INSERT` and a seed script too, which is the argument ADR-0012
 * makes about the chain and the reason `lockResults` was never migrated onto a transaction either.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { violatedConstraint } from "@/db/errors";
import { charges, depositEvents, MONEY_CONSTRAINTS } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor } from "@/lib/auth/scope";
import { listRosterForBoard } from "@/lib/auth/scope";
import type { DepositState } from "./deposit";
import { allowedFrom, canTransition, currentState, isTerminal } from "./deposit";

export type DepositView = {
  chargeId: string;
  teamId: string;
  teamName: string;
  bidCode: string;
  amountCents: number;
  state: DepositState;
  canMoveTo: readonly DepositState[];
};

export type DepositResult = { ok: true; state: DepositState } | { ok: false; message: string };

/**
 * Every live deposit in the comp, with the state its chain is in.
 *
 * Built over `listRosterForBoard`, so a `chargeId` here is already resolved against the window that
 * produced it — the same one level down `find` A3 established, and not a fourth window.
 */
export const listDepositsForBoard = async (actor: BoardActor): Promise<DepositView[]> => {
  const roster = await listRosterForBoard(actor);

  const deposits = roster.flatMap((team) =>
    team.charges
      .filter((charge) => charge.kind === "deposit")
      .map((charge) => ({ team, charge })),
  );
  if (deposits.length === 0) return [];

  const events = await db
    .select({ chargeId: depositEvents.chargeId, seq: depositEvents.seq, state: depositEvents.state })
    .from(depositEvents)
    .where(
      and(
        eq(depositEvents.compId, actor.compId),
        inArray(
          depositEvents.chargeId,
          deposits.map(({ charge }) => charge.id),
        ),
      ),
    );

  const byCharge = new Map<string, { seq: number; state: DepositState }[]>();
  for (const event of events) {
    const chain = byCharge.get(event.chargeId) ?? [];
    chain.push({ seq: event.seq, state: event.state });
    byCharge.set(event.chargeId, chain);
  }

  return deposits.map(({ team, charge }) => {
    const state = currentState(byCharge.get(charge.id) ?? []);
    return {
      chargeId: charge.id,
      teamId: team.id,
      teamName: team.name,
      bidCode: team.bidCode,
      amountCents: charge.amountCents,
      state,
      canMoveTo: allowedFrom(state),
    };
  });
};

/**
 * Appends one transition, or refuses.
 *
 * The `chargeId` is a claim and resolves through `listDepositsForBoard`, which is
 * `listRosterForBoard` with the deposit chain attached — comp scope and "is live" both come free
 * from that read's own `where`, exactly as the window rule requires.
 *
 * A refused transition and a refused *second ending* are different failures and say different
 * things: the first is a board asking for something the machine does not permit, the second is a
 * board clicking twice. Only the second reaches the database.
 */
export const advanceDeposit = async (
  actor: BoardActor,
  chargeId: string,
  to: DepositState,
  reason: string | null,
): Promise<DepositResult> => {
  const deposits = await listDepositsForBoard(actor);
  const deposit = deposits.find((row) => row.chargeId === chargeId);
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

  try {
    await db.insert(depositEvents).values({
      compId: actor.compId,
      chargeId,
      state: to,
      reason,
      createdByPersonId: actor.personId,
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
    return { ok: false, message: "Could not record that. Nothing was saved — reload and try again." };
  }

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "deposit.transition",
    entity: "charge",
    entityId: chargeId,
    before: { state: deposit.state },
    after: { state: to, reason },
  });

  return { ok: true, state: to };
};

/** The live deposit charges of a comp, for the seed and the doctor. Never a voided one. */
export const liveDepositCharges = (compId: string) =>
  db
    .select({ id: charges.id, teamId: charges.teamId, amountCents: charges.amountCents })
    .from(charges)
    .where(
      and(eq(charges.compId, compId), eq(charges.kind, "deposit"), isNull(charges.voidedAt)),
    );
