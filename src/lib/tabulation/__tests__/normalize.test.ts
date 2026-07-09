import { describe, expect, it } from "vitest";
import { judgeTeamTotals } from "../aggregate";
import { normalize } from "../normalize";
import { CHOREO, rubric, scoresFrom } from "./fixtures";

const ONE_CRITERION = [CHOREO];

const totalsFor = (table: Record<string, Record<string, number[]>>) =>
  judgeTeamTotals(
    {
      teams: ["A", "B", "C"],
      judges: Object.keys(table),
      scores: scoresFrom(table, ONE_CRITERION),
      deductions: [],
    },
    rubric("raw", [], ONE_CRITERION),
  );

describe("normalize", () => {
  it("raw averages each team's weighted totals across the judges who scored it", () => {
    const aggregates = normalize(
      totalsFor({ j1: { A: [90], B: [80], C: [70] }, j2: { A: [100], B: [95], C: [90] } }),
      "raw",
    );

    expect(aggregates.get("A")).toBe(95);
    expect(aggregates.get("B")).toBe(87.5);
    expect(aggregates.get("C")).toBe(80);
  });

  it("zscore rescales each judge onto their own spread, so a harsh judge counts equally", () => {
    // j1 spans 70-90, j2 spans 90-100. Both rank A > B > C by the same relative margins,
    // so after normalization every team's z is identical across the two judges.
    const aggregates = normalize(
      totalsFor({ j1: { A: [90], B: [80], C: [70] }, j2: { A: [100], B: [95], C: [90] } }),
      "zscore",
    );

    expect(aggregates.get("A")).toBeCloseTo(Math.sqrt(1.5), 12);
    expect(aggregates.get("B")).toBeCloseTo(0, 12);
    expect(aggregates.get("C")).toBeCloseTo(-Math.sqrt(1.5), 12);
  });

  it("zscore contributes 0, not NaN, when a judge scores every team identically", () => {
    const aggregates = normalize(
      totalsFor({ j1: { A: [80], B: [80], C: [80] }, j2: { A: [90], B: [80], C: [70] } }),
      "zscore",
    );

    for (const teamId of ["A", "B", "C"]) {
      expect(Number.isNaN(aggregates.get(teamId)!)).toBe(false);
    }
    // j1 washes out entirely; ordering is decided by j2 alone.
    expect(aggregates.get("A")!).toBeGreaterThan(aggregates.get("B")!);
    expect(aggregates.get("B")!).toBeGreaterThan(aggregates.get("C")!);
  });

  it("zscore contributes 0 when a judge scored exactly one team", () => {
    const aggregates = normalize(totalsFor({ j1: { A: [90] } }), "zscore");
    expect(aggregates.get("A")).toBe(0);
  });

  it("rank negates the mean rank so higher stays better", () => {
    const aggregates = normalize(
      totalsFor({ j1: { A: [90], B: [80], C: [70] }, j2: { A: [50], B: [99], C: [10] } }),
      "rank",
    );

    // A: ranks 1 and 2 -> mean 1.5. B: ranks 2 and 1 -> mean 1.5. C: ranks 3 and 3 -> mean 3.
    expect(aggregates.get("A")).toBe(-1.5);
    expect(aggregates.get("B")).toBe(-1.5);
    expect(aggregates.get("C")).toBe(-3);
  });

  it("rank gives equally-scored teams the average of the positions they occupy", () => {
    const aggregates = normalize(totalsFor({ j1: { A: [90], B: [90], C: [70] } }), "rank");

    // A and B share positions 1 and 2 -> both get 1.5.
    expect(aggregates.get("A")).toBe(-1.5);
    expect(aggregates.get("B")).toBe(-1.5);
    expect(aggregates.get("C")).toBe(-3);
  });

  it("applies criterion weights in basis points", () => {
    const halfWeighted = { ...CHOREO, weightBp: 5_000 };
    const totals = judgeTeamTotals(
      {
        teams: ["A"],
        judges: ["j1"],
        scores: scoresFrom({ j1: { A: [80] } }, [halfWeighted]),
        deductions: [],
      },
      rubric("raw", [], [halfWeighted]),
    );

    expect(normalize(totals, "raw").get("A")).toBe(40);
  });
});
