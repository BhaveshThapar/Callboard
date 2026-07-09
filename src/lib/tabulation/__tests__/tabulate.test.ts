import { describe, expect, it } from "vitest";
import { tabulate } from "../tabulate";
import type { DeductionInput, NormalizationMethod } from "../types";
import { orderOf, placementOf, rubric, scoresFrom } from "./fixtures";

const TABLE = {
  j1: { A: [50, 30], B: [45, 30], C: [40, 25] },
  j2: { A: [55, 35], B: [50, 30], C: [45, 20] },
} satisfies Record<string, Record<string, number[]>>;

const run = (method: NormalizationMethod, deductions: DeductionInput[] = []) =>
  tabulate(
    { teams: ["A", "B", "C"], judges: ["j1", "j2"], scores: scoresFrom(TABLE), deductions },
    rubric(method),
  );

const penalty = (teamId: string, points: number): DeductionInput => ({
  teamId,
  points,
  reason: "over time",
});

describe("tabulate", () => {
  it("reports the deduction it applied", () => {
    const result = run("raw", [penalty("A", 5)]);
    expect(placementOf(result, "A").deductionPoints).toBe(5);
    expect(placementOf(result, "B").deductionPoints).toBe(0);
  });

  it("sums multiple deductions against the same team", () => {
    const result = run("raw", [penalty("A", 5), { teamId: "A", points: 3, reason: "prop violation" }]);
    expect(placementOf(result, "A").deductionPoints).toBe(8);
  });

  it("under raw, a deduction subtracts exactly from the team's mean", () => {
    // Deductions are applied to every judge's total before normalization. For `raw` the mean is
    // affine, so this must be provably identical to subtracting from the aggregate afterwards.
    const clean = run("raw");
    const penalized = run("raw", [penalty("A", 7)]);

    expect(placementOf(penalized, "A").aggregate).toBeCloseTo(
      placementOf(clean, "A").aggregate - 7,
      12,
    );
    expect(placementOf(penalized, "B").aggregate).toBe(placementOf(clean, "B").aggregate);
  });

  it("a large enough deduction drops a team from first to last", () => {
    expect(orderOf(run("raw"))).toEqual(["A", "B", "C"]);
    expect(orderOf(run("raw", [penalty("A", 30)]))).toEqual(["B", "C", "A"]);
  });

  it("applies deductions under zscore without producing NaN", () => {
    const penalized = run("zscore", [penalty("A", 30)]);

    for (const placement of penalized.placements) {
      expect(Number.isFinite(placement.aggregate)).toBe(true);
    }
    expect(orderOf(penalized)).toEqual(["B", "C", "A"]);
  });

  it("applies deductions under rank, changing the order each judge implies", () => {
    expect(orderOf(run("rank"))).toEqual(["A", "B", "C"]);
    expect(orderOf(run("rank", [penalty("A", 30)]))).toEqual(["B", "C", "A"]);
  });

  it("carries the normalization method through to the result", () => {
    expect(run("zscore").method).toBe("zscore");
  });

  it("is invariant to the order scores arrive in", () => {
    const base = { teams: ["A", "B", "C"], judges: ["j1", "j2"], deductions: [] };
    const scores = scoresFrom(TABLE);
    const shuffled = [...scores].reverse();

    const forward = tabulate({ ...base, scores }, rubric("zscore"));
    const backward = tabulate({ ...base, scores: shuffled }, rubric("zscore"));

    expect(backward).toEqual(forward);
  });

  it("returns no placements and every team unscored when nobody has scored yet", () => {
    const result = tabulate(
      { teams: ["A", "B"], judges: ["j1"], scores: [], deductions: [] },
      rubric("zscore"),
    );

    expect(result.placements).toEqual([]);
    expect(result.unscored).toEqual(["A", "B"]);
  });

  it("ignores scores for criteria that are not on the rubric", () => {
    const withGhost = tabulate(
      {
        teams: ["A", "B", "C"],
        judges: ["j1", "j2"],
        scores: [
          ...scoresFrom(TABLE),
          { judgeId: "j1", teamId: "A", criterionId: "not-on-this-rubric", rawValue: 999 },
        ],
        deductions: [],
      },
      rubric("raw"),
    );

    expect(placementOf(withGhost, "A").aggregate).toBe(placementOf(run("raw"), "A").aggregate);
  });
});
