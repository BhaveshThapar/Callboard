import { describe, expect, it } from "vitest";
import { describeBalance, formatCents } from "../format";

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

describe("describeBalance", () => {
  it("says who owes whom rather than leaving a sign to be read", () => {
    expect(describeBalance(168_000)).toBe("owes $1,680.00");
    expect(describeBalance(-112_000)).toBe("owed $1,120.00");
    expect(describeBalance(0)).toBe("settled");
  });
});
