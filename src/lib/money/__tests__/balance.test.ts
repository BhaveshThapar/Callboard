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

  it("sums obligations against every cent that arrived", () => {
    // 16 dancers at $70 + 4 rooms at $140 + $100 deposit, with the deposit paid.
    const balance = teamBalance(
      [charge("reg", 112_000), charge("hotel", 56_000), charge("dep", 10_000, 10_000)],
      10_000,
    );

    expect(balance).toEqual({ owedCents: 178_000, paidCents: 10_000, balanceCents: 168_000 });
  });

  it("reads zero when a team is settled exactly", () => {
    expect(teamBalance([charge("a", 10_000, 10_000)], 10_000).balanceCents).toBe(0);
  });

  /**
   * The regression an e2e caught and the unit tests had missed, because the old implementation
   * derived `paid` from allocations to *live* charges. A team that paid, dropped and came back has
   * its charges regenerated and its allocations still pointing at the voided originals -- so the
   * money vanished and the team was billed the whole amount a second time, with its payment still
   * sitting in the org's account. Total payments is the only figure that survives a void.
   */
  it("counts money whose original charge was voided, so a reinstated team is not billed twice", () => {
    const regenerated = [charge("reg-new", 140_000), charge("hotel-new", 70_000), charge("dep-new", 10_000)];
    // Nothing is allocated to the new rows -- the allocations still name the voided ones.
    expect(teamBalance(regenerated, 220_000).balanceCents).toBe(0);
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
    // NCSU's $2,160 lump against $1,600 of obligations: $560 arrived with nothing to settle.
    const balance = teamBalance([charge("a", 160_000, 160_000)], 216_000);
    expect(balance).toEqual({ owedCents: 160_000, paidCents: 216_000, balanceCents: -56_000 });
  });

  it("stays in integer cents through the $97.01 case", () => {
    const balance = teamBalance([charge("dep", 10_000, 9_701)], 9_701);
    expect(balance.balanceCents).toBe(299);
    expect(Number.isInteger(balance.balanceCents)).toBe(true);
  });
});
