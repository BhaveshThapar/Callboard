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
  owedCents: number;
  paidCents: number;
  /**
   * `owed - paid`. **Negative means the org owes the team** — a team that paid and then dropped has
   * its charges voided but keeps its allocations, and stating that as a negative balance is the
   * whole reason charges are voided rather than deleted. Do not clamp this at zero.
   */
  balanceCents: number;
};

export const teamBalance = (charges: readonly ChargeLineView[], creditCents = 0): TeamBalance => {
  const owedCents = charges.reduce((sum, charge) => sum + charge.amountCents, 0);
  const allocated = charges.reduce((sum, charge) => sum + charge.paidCents, 0);
  const paidCents = allocated + creditCents;

  return { owedCents, paidCents, balanceCents: owedCents - paidCents };
};
