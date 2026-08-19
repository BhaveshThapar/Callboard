import { describe, expect, it } from "vitest";
import { defaultRail, planSurcharge, processingFeeCents, US_RATES } from "../rates";

const usd = (dollars: number): number => Math.round(dollars * 100);

describe("processingFeeCents — card", () => {
  it("is 2.9% + 30c at the standard rate", () => {
    expect(processingFeeCents(usd(100), "card", "standard")).toBe(320);
  });

  /**
   * A first draft of this file asserted that a $100 card charge nets $97.01, citing PRD §14's BU
   * Dheem exhibit. **That is a Venmo fee, not a Stripe one** — 2.99% flat, which is where $2.99
   * comes from; Stripe's 2.9% + 30c on the same $100 is $3.20 and nets $96.80.
   *
   * Worth keeping as a test rather than deleting, because the mistake is the argument for the
   * schema: `payments.fee_cents` is **recorded per payment**, not computed from a rate card, exactly
   * so that a rail whose pricing this repo does not model still reconciles. A product that derived
   * the fee would have quietly restated Dheem's deposit.
   */
  it("does not reproduce the Venmo exhibit, which is why fee_cents is recorded and not derived", () => {
    expect(usd(100) - processingFeeCents(usd(100), "card", "standard")).toBe(usd(96.8));
    expect(usd(100) - 299).toBe(usd(97.01));
  });

  it("is 2.2% + 30c at the verified-nonprofit rate, which most host orgs qualify for", () => {
    expect(processingFeeCents(usd(100), "card", "nonprofit")).toBe(250);
  });

  it("saves a real amount on a real lump", () => {
    // NCSU's $2,160, the other §14 exhibit.
    const standard = processingFeeCents(usd(2160), "card", "standard");
    const nonprofit = processingFeeCents(usd(2160), "card", "nonprofit");
    expect(standard).toBe(6294);
    expect(nonprofit).toBe(4782);
    expect(standard - nonprofit).toBe(1512);
  });
});

describe("processingFeeCents — ACH, and the cap that is the whole point of A5a", () => {
  it("is 0.8% below the cap", () => {
    expect(processingFeeCents(usd(100), "ach", "standard")).toBe(80);
  });

  it("caps at $5, so anything above ~$625 pays a flat five dollars", () => {
    expect(processingFeeCents(usd(625), "ach", "standard")).toBe(500);
    expect(processingFeeCents(usd(2160), "ach", "standard")).toBe(500);
    expect(processingFeeCents(usd(100_000), "ach", "standard")).toBe(500);
  });

  it("ignores the card rate, because the nonprofit rate is a card rate", () => {
    expect(processingFeeCents(usd(300), "ach", "nonprofit")).toBe(
      processingFeeCents(usd(300), "ach", "standard"),
    );
  });

  /**
   * PAYMENTS.md's claim, checked rather than repeated: an ~$11.5k season is "~$250+ all-card" against
   * "roughly $60–80" ACH-first. Modelled as Mayuri's own shape — lumps, not impulse checkouts.
   */
  it("turns a season's processing cost from ~$250 into well under $100", () => {
    const lumps = [2160, 1800, 1500, 1400, 1260, 1100, 980, 800, 640, 400].map(usd);
    const allCard = lumps.reduce((t, c) => t + processingFeeCents(c, "card", "standard"), 0);
    const achFirst = lumps.reduce((t, c) => t + processingFeeCents(c, "ach", "standard"), 0);
    expect(allCard).toBeGreaterThan(usd(290));
    expect(achFirst).toBeLessThan(usd(80));
  });
});

describe("defaultRail", () => {
  it("sends a lump over ACH and leaves a small item on card", () => {
    expect(defaultRail(usd(2160))).toBe("ach");
    expect(defaultRail(usd(250))).toBe("ach");
    expect(defaultRail(usd(100))).toBe("card");
  });
});

describe("planSurcharge — A5c", () => {
  it("leaves the comp short when it absorbs the fee, and says so", () => {
    const plan = planSurcharge(usd(100), "card", "standard", { passThrough: false });
    expect(plan).toEqual({
      chargedCents: usd(100),
      surchargeCents: 0,
      feeCents: 320,
      netCents: usd(96.8),
    });
  });

  /**
   * The point of A5c, and the honest limit of it: on a card the org gets **close** to whole, not
   * whole. 2.9% + 30c on $100 is $3.20, but the network cap forbids surcharging more than 3% — so
   * the pass-through recovers $3.00 of a $3.29 fee and the org is 29c short.
   *
   * That shortfall is stated rather than hidden, because the alternative is a product that claims
   * "you net exactly what you charge" and leaves a treasurer to find the gap in April. It is the
   * §14 species in miniature: a small discrepancy nobody was shown.
   */
  it("passes the fee on, and the 3% cap is why the org is still a few cents short on a card", () => {
    const plan = planSurcharge(usd(100), "card", "standard", { passThrough: true });
    expect(plan.chargedCents).toBe(usd(103));
    expect(plan.surchargeCents).toBe(usd(3));
    expect(plan.feeCents).toBe(329);
    expect(plan.netCents).toBe(9971);
    expect(usd(100) - plan.netCents).toBe(29);
  });

  it("never surcharges past 3%, because the card networks do not allow it", () => {
    for (const amount of [100, 500, 2160, 10_000]) {
      const plan = planSurcharge(usd(amount), "card", "standard", { passThrough: true });
      expect(plan.surchargeCents).toBeLessThanOrEqual(Math.floor(usd(amount) * 0.03) + 1);
    }
  });

  it("respects a comp that sets a lower cap than the network's", () => {
    const plan = planSurcharge(usd(1000), "card", "standard", { passThrough: true, capBp: 100 });
    expect(plan.surchargeCents).toBeLessThanOrEqual(usd(10));
  });

  it("barely surcharges an ACH lump, because the fee is capped at $5", () => {
    const plan = planSurcharge(usd(2160), "ach", "standard", { passThrough: true });
    expect(plan.surchargeCents).toBe(500);
    expect(plan.netCents).toBe(usd(2160));
  });
});

describe("the arithmetic itself", () => {
  it("is integer cents throughout — no float ever reaches a total", () => {
    for (const amount of [1, 7, 99, 12_345, 216_000]) {
      for (const rail of ["ach", "card"] as const) {
        const fee = processingFeeCents(amount, rail, "standard");
        expect(Number.isInteger(fee)).toBe(true);
        const plan = planSurcharge(amount, rail, "standard", { passThrough: true });
        for (const v of Object.values(plan)) expect(Number.isInteger(v)).toBe(true);
      }
    }
  });

  it("refuses a nonsense amount rather than inventing a fee for it", () => {
    expect(processingFeeCents(0, "card", "standard")).toBe(0);
    expect(processingFeeCents(-100, "card", "standard")).toBe(0);
    expect(processingFeeCents(10.5, "card", "standard")).toBe(0);
  });

  it("takes its rates as data, because they are Stripe's to change", () => {
    const cheaper = { ...US_RATES, standard: { ...US_RATES.standard, cardBp: 100 } };
    expect(processingFeeCents(usd(100), "card", "standard", cheaper)).toBe(130);
  });
});
