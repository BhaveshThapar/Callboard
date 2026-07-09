import { describe, expect, it } from "vitest";
import type { JudgeRosterRow } from "../progress";
import { judgeProgress, progressTotals } from "../progress";

const EXPECTED_PER_JUDGE = 32;

const roster = (...judges: Array<[string, boolean]>): JudgeRosterRow[] =>
  judges.map(([assignmentId, revoked]) => ({ assignmentId, name: assignmentId, revoked }));

const percent = (submitted: number, expected: number): number =>
  expected === 0 ? 0 : (submitted / expected) * 100;

describe("judgeProgress", () => {
  it("counts every active judge", () => {
    const judges = judgeProgress(
      roster(["a", false], ["b", false], ["c", false]),
      new Map([
        ["a", 32],
        ["b", 32],
        ["c", 32],
      ]),
      EXPECTED_PER_JUDGE,
    );

    expect(judges).toHaveLength(3);
    expect(progressTotals(judges)).toEqual({ submitted: 96, expected: 96 });
  });

  it("keeps a revoked judge who already scored, so the bar cannot exceed 100%", () => {
    const judges = judgeProgress(
      roster(["a", true], ["b", false], ["c", false]),
      new Map([
        ["a", 32],
        ["b", 32],
        ["c", 32],
      ]),
      EXPECTED_PER_JUDGE,
    );

    const totals = progressTotals(judges);
    expect(judges).toHaveLength(3);
    expect(judges.find((j) => j.assignmentId === "a")?.revoked).toBe(true);
    expect(totals).toEqual({ submitted: 96, expected: 96 });
    expect(percent(totals.submitted, totals.expected)).toBe(100);
  });

  it("drops a revoked judge who never scored, so the bar can still reach 100%", () => {
    const judges = judgeProgress(
      roster(["leaked", true], ["b", false], ["c", false]),
      new Map([
        ["b", 32],
        ["c", 32],
      ]),
      EXPECTED_PER_JUDGE,
    );

    const totals = progressTotals(judges);
    expect(judges.map((j) => j.assignmentId)).toEqual(["b", "c"]);
    expect(totals).toEqual({ submitted: 64, expected: 64 });
    expect(percent(totals.submitted, totals.expected)).toBe(100);
  });

  it("never lets submitted exceed expected, for any revocation pattern", () => {
    const patterns: Array<Array<[string, boolean]>> = [
      [["a", true]],
      [
        ["a", true],
        ["b", true],
      ],
      [
        ["a", true],
        ["b", false],
      ],
      [
        ["a", false],
        ["b", true],
        ["c", true],
      ],
    ];

    for (const pattern of patterns) {
      const counts = new Map(pattern.map(([id]) => [id, EXPECTED_PER_JUDGE] as const));
      const totals = progressTotals(judgeProgress(roster(...pattern), counts, EXPECTED_PER_JUDGE));
      expect(totals.submitted).toBeLessThanOrEqual(totals.expected);
    }
  });

  it("reports a partially scored judge without dropping them", () => {
    const judges = judgeProgress(roster(["a", false]), new Map([["a", 12]]), EXPECTED_PER_JUDGE);

    expect(judges[0]).toMatchObject({ submitted: 12, expected: 32, revoked: false });
  });
});
