import { describe, expect, it } from "vitest";
import { describeBalance, formatCents, parseDollars } from "../format";

describe("formatCents", () => {
  it("renders whole dollars with cents", () => {
    expect(formatCents(112_000)).toBe("$1,120.00");
    expect(formatCents(10_000)).toBe("$100.00");
  });

  it("renders the $97.01 deposit exactly", () => {
    expect(formatCents(9_701)).toBe("$97.01");
  });

  it("pads a single-cent remainder rather than dropping the zero", () => {
    expect(formatCents(1_005)).toBe("$10.05");
    expect(formatCents(5)).toBe("$0.05");
  });

  it("groups thousands", () => {
    expect(formatCents(216_000)).toBe("$2,160.00");
    expect(formatCents(1_234_567)).toBe("$12,345.67");
  });

  it("is zero, not empty", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("puts the sign outside the dollar mark", () => {
    expect(formatCents(-112_000)).toBe("-$1,120.00");
    expect(formatCents(-5)).toBe("-$0.05");
  });
});

describe("parseDollars", () => {
  it("reads the two payments PRD §14 is made of", () => {
    expect(parseDollars("97.01")).toBe(9_701);
    expect(parseDollars("2,160")).toBe(216_000);
    expect(parseDollars("$1,780.00")).toBe(178_000);
  });

  it("treats a missing or short fraction as trailing zeros, not leading ones", () => {
    expect(parseDollars("100")).toBe(10_000);
    expect(parseDollars("1.5")).toBe(150);
    expect(parseDollars("0.05")).toBe(5);
  });

  it("refuses a third decimal place rather than rounding it away", () => {
    // `Math.round(parseFloat("1.005") * 100)` is 100, not 101 — a cent that disappears with no
    // error. Refusing is the same argument as `payments_net_identity_check` being a CHECK.
    expect(parseDollars("1.005")).toBeNull();
    expect(parseDollars("11.045")).toBeNull();
  });

  it("refuses everything that is not an amount", () => {
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("   ")).toBeNull();
    expect(parseDollars("-5")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("1.2.3")).toBeNull();
    expect(parseDollars("1e3")).toBeNull();
  });

  it("round-trips through formatCents", () => {
    for (const cents of [0, 5, 9_701, 10_000, 216_000, 1_234_567]) {
      expect(parseDollars(formatCents(cents))).toBe(cents);
    }
  });
});

describe("describeBalance", () => {
  it("says who owes whom rather than leaving a sign to be read", () => {
    expect(describeBalance(168_000)).toBe("owes $1,680.00");
    expect(describeBalance(-112_000)).toBe("owed $1,120.00");
    expect(describeBalance(0)).toBe("settled");
  });
});
