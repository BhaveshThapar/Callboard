/**
 * What a team owes, given its live charges and what has been allocated against them.
 *
 * Pure and DB-free, so the arithmetic the product is sold on is somewhere a test can reach without a
 * database. It is not in `src/lib/fees/` because it is not the fee *schedule* — that module answers
 * "what does this comp charge", this one answers "where does this team stand", and only the second
 * needs to know what arrived.
 */

export type ChargeLineView = {
  id: string;
  kind: string;
  amountCents: number;
  dueAt: string | null;
  /** What has been allocated to this specific charge. */
  paidCents: number;
};

export type TeamBalance = {
  /** The sum of the team's **live** charges. A voided charge is history, not an obligation. */
  owedCents: number;
  /** Every cent that arrived for this team, whatever it was allocated against — or wasn't. */
  paidCents: number;
  /**
   * `owed - paid`. **Negative means the org owes the team.** Do not clamp this at zero: a team that
   * paid and then dropped has its charges voided and its money still in the org's account, and
   * saying so is the whole reason charges are voided rather than deleted.
   */
  balanceCents: number;
};

/**
 * **`paidCents` is total payments, not the sum of allocations to live charges.** That distinction is
 * the whole correctness of this function, and getting it wrong is a bug an e2e caught rather than a
 * subtlety worth trusting a comment about.
 *
 * Allocations answer *what was this money for*. The balance answers *does this team owe anything*.
 * Deriving the second from the first loses every cent whose charge was later voided — so a team that
 * paid $2,200, dropped, and was reinstated would be billed the full $2,200 a second time, its
 * payment still sitting in the org's account and visible nowhere. That is precisely the failure this
 * product is sold against, reintroduced by the product.
 *
 * The per-charge `paidCents` on `ChargeLineView` stays, because "which obligation is settled" is a
 * real question. It is just not this one.
 */
export const teamBalance = (
  charges: readonly ChargeLineView[],
  paidCents = 0,
): TeamBalance => {
  const owedCents = charges.reduce((sum, charge) => sum + charge.amountCents, 0);
  return { owedCents, paidCents, balanceCents: owedCents - paidCents };
};

/**
 * What is still unsettled on one obligation, and what is still unattached on one payment.
 *
 * Both are one subtraction, and both exist so the entry form's readout, the ledger's refusal, and
 * the unattributed-credit panel cannot drift apart into three definitions of "what is left".
 *
 * **Neither clamps at zero**, for `teamBalance`'s reason: a negative is information. A charge whose
 * allocations exceed it has been over-attributed, and that is a thing to be able to see rather than
 * a thing to round away.
 */
export const remainingOnCharge = (charge: ChargeLineView): number =>
  charge.amountCents - charge.paidCents;

export const unallocatedCents = (payment: {
  grossCents: number;
  allocatedCents: number;
}): number => payment.grossCents - payment.allocatedCents;
