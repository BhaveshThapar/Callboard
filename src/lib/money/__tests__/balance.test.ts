import { describe, expect, it } from "vitest";
import type { ChargeLineView } from "../balance";
import { teamBalance } from "../balance";

const charge = (id: string, amountCents: number, paidCents = 0): ChargeLineView => ({
  id,
  kind: "registration",
  amountCents,
  dueAt: null,
  paidCents,
});

describe("teamBalance", () => {
  it("is zero for a team with no charges", () => {
    expect(teamBalance([])).toEqual({ owedCents: 0, paidCents: 0, balanceCents: 0 });
  });

  it("sums obligations and what has been allocated against them", () => {
    // 16 dancers at $70 + 4 rooms at $140 + $100 deposit, with the deposit paid.
    const balance = teamBalance([
      charge("reg", 112_000),
      charge("hotel", 56_000),
      charge("dep", 10_000, 10_000),
    ]);

    expect(balance).toEqual({ owedCents: 178_000, paidCents: 10_000, balanceCents: 168_000 });
  });

  it("reads zero when a team is settled exactly", () => {
    expect(teamBalance([charge("a", 10_000, 10_000)]).balanceCents).toBe(0);
  });

  /**
   * The case charges are voided rather than deleted for. A team that paid $1,120 and then dropped
   * has no live charges left, but its allocations survive — so the org owes it, and the product says
   * so instead of a treasurer finding out in April. Clamping this at zero would erase exactly the
   * fact worth surfacing.
   */
  it("goes negative when the org owes the team", () => {
    const balance = teamBalance([], 112_000);
    expect(balance).toEqual({ owedCents: 0, paidCents: 112_000, balanceCents: -112_000 });
  });

  it("counts an unapplied credit as paid without attaching it to a charge", () => {
    // NCSU's $2,160 lump, of which $1,600 is allocated and $560 is still sitting unapplied.
    const balance = teamBalance([charge("a", 160_000, 160_000)], 56_000);
    expect(balance).toEqual({ owedCents: 160_000, paidCents: 216_000, balanceCents: -56_000 });
  });

  it("stays in integer cents through the $97.01 case", () => {
    const balance = teamBalance([charge("dep", 10_000, 9_701)]);
    expect(balance.balanceCents).toBe(299);
    expect(Number.isInteger(balance.balanceCents)).toBe(true);
  });
});
