import { describe, expect, it } from "vitest";
import { tabulate } from "../tabulate";
import type { Tiebreaker } from "../types";
import { CHOREO, EXECUTION, orderOf, placementOf, rubric, scoresFrom } from "./fixtures";

const run = (
  table: Record<string, Record<string, number[]>>,
  tiebreakers: Tiebreaker[] = [],
  teams = ["A", "B", "C"],
) =>
  tabulate(
    { teams, judges: Object.keys(table), scores: scoresFrom(table), deductions: [] },
    rubric("raw", tiebreakers),
  );

describe("rankTeams", () => {
  it("orders teams by aggregate, best first", () => {
    const result = run({ j1: { A: [50, 30], B: [55, 35], C: [40, 20] } });
    expect(orderOf(result)).toEqual(["B", "A", "C"]);
    expect(placementOf(result, "B").place).toBe(1);
  });

  it("gives tied teams the same place and skips the place they consumed", () => {
    const result = run({ j1: { A: [50, 30], B: [50, 30], C: [40, 20] } });

    expect(placementOf(result, "A").place).toBe(1);
    expect(placementOf(result, "B").place).toBe(1);
    expect(placementOf(result, "C").place).toBe(3);
  });

  it("surfaces an unbreakable tie instead of silently picking a winner", () => {
    const result = run({ j1: { A: [50, 30], B: [50, 30], C: [40, 20] } });

    expect(result.unresolvedTies).toEqual([["A", "B"]]);
    expect(placementOf(result, "A").tiedWith).toEqual(["B"]);
    expect(placementOf(result, "A").resolvedBy).toBeNull();
  });

  it("breaks a tie on a designated criterion", () => {
    const tiebreakers: Tiebreaker[] = [{ kind: "criterion", criterionId: CHOREO.id }];
    // Both total 80. A is stronger on choreography.
    const result = run({ j1: { A: [50, 30], B: [40, 40], C: [40, 20] } }, tiebreakers);

    expect(result.unresolvedTies).toEqual([]);
    expect(placementOf(result, "A").place).toBe(1);
    expect(placementOf(result, "B").place).toBe(2);
    expect(placementOf(result, "A").resolvedBy).toBe("criterion");
  });

  it("breaks a tie head-to-head when more judges preferred one team", () => {
    const tiebreakers: Tiebreaker[] = [{ kind: "head_to_head" }];
    // A and B both average 80, but two of three judges scored A above B.
    const result = run(
      {
        j1: { A: [90, 0], B: [80, 0] },
        j2: { A: [70, 0], B: [90, 0] },
        j3: { A: [80, 0], B: [70, 0] },
      },
      tiebreakers,
      ["A", "B"],
    );

    expect(placementOf(result, "A").place).toBe(1);
    expect(placementOf(result, "B").place).toBe(2);
    expect(placementOf(result, "A").resolvedBy).toBe("head_to_head");
  });

  it("falls through to the next tiebreaker when the first cannot discriminate", () => {
    // Identical on choreography, so `criterion` finds nothing; head-to-head then splits them.
    const tiebreakers: Tiebreaker[] = [
      { kind: "criterion", criterionId: CHOREO.id },
      { kind: "head_to_head" },
    ];
    const result = run(
      {
        j1: { A: [40, 50], B: [40, 40] },
        j2: { A: [40, 30], B: [40, 50] },
        j3: { A: [40, 40], B: [40, 30] },
      },
      tiebreakers,
      ["A", "B"],
    );

    expect(placementOf(result, "A").resolvedBy).toBe("head_to_head");
    expect(placementOf(result, "A").place).toBe(1);
  });

  it("breaks a tie on the single highest judge total", () => {
    const tiebreakers: Tiebreaker[] = [{ kind: "highest_single_judge" }];
    // Both average 80. B peaked higher with one judge.
    const result = run(
      { j1: { A: [80, 0], B: [95, 0] }, j2: { A: [80, 0], B: [65, 0] } },
      tiebreakers,
      ["A", "B"],
    );

    expect(placementOf(result, "B").place).toBe(1);
    expect(placementOf(result, "B").resolvedBy).toBe("highest_single_judge");
  });

  it("leaves a team untouched when it never tied", () => {
    const result = run({ j1: { A: [50, 30], B: [45, 30], C: [40, 20] } });
    expect(placementOf(result, "A").resolvedBy).toBeNull();
    expect(placementOf(result, "A").tiedWith).toEqual([]);
  });

  it("excludes unscored teams from placements rather than treating them as zeroes", () => {
    const result = run({ j1: { A: [50, 30], B: [45, 30] } }, [], ["A", "B", "C", "D"]);

    expect(result.unscored).toEqual(["C", "D"]);
    expect(orderOf(result)).toEqual(["A", "B"]);
  });

  it("reports how many judges scored each team, for partial live standings", () => {
    const result = run({ j1: { A: [50, 30], B: [45, 30] }, j2: { A: [50, 30] } }, [], ["A", "B"]);

    expect(placementOf(result, "A").judgeCount).toBe(2);
    expect(placementOf(result, "B").judgeCount).toBe(1);
  });

  it("is deterministic: an unresolved tie is ordered by team id, not by input order", () => {
    const forward = run({ j1: { A: [50, 30], B: [50, 30] } }, [], ["A", "B"]);
    const reversed = tabulate(
      {
        teams: ["B", "A"],
        judges: ["j1"],
        scores: scoresFrom({ j1: { B: [50, 30], A: [50, 30] } }),
        deductions: [],
      },
      rubric("raw"),
    );

    expect(orderOf(forward)).toEqual(orderOf(reversed));
    expect(orderOf(forward)).toEqual(["A", "B"]);
  });

  it("can break a tie on a criterion other than the first", () => {
    const tiebreakers: Tiebreaker[] = [{ kind: "criterion", criterionId: EXECUTION.id }];
    const result = run({ j1: { A: [50, 30], B: [30, 50] } }, tiebreakers, ["A", "B"]);

    expect(placementOf(result, "B").place).toBe(1);
    expect(placementOf(result, "B").resolvedBy).toBe("criterion");
  });
});
