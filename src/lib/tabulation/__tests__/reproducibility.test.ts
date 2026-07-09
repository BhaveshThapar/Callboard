import { describe, expect, it } from "vitest";
import { tabulate } from "../tabulate";
import type { Rubric, ScoreInput, TabulationInput, TabulationResult } from "../types";
import { CHOREO, EXECUTION } from "./fixtures";

/**
 * The promise this file defends: a locked result can be reproduced tomorrow from its snapshot.
 * If it ever fails, the audit trail is a lie and PRD §13's "100% next-day reproducibility" is unmet.
 */

const TEAMS = ["bid-01", "bid-02", "bid-03", "bid-04", "bid-05", "bid-06", "bid-07", "bid-08"];
const JUDGES = ["judge-a", "judge-b", "judge-c"];

const MUSICALITY = { id: "c3", label: "Musicality", maxPoints: 40, weightBp: 7_500, sortOrder: 2 };

const RUBRIC: Rubric = {
  id: "fusion-2027",
  normalization: "zscore",
  criteria: [CHOREO, EXECUTION, MUSICALITY],
  tiebreakers: [{ kind: "criterion", criterionId: EXECUTION.id }, { kind: "head_to_head" }],
};

/** Deterministic score generator. No Math.random: the fixture itself has to be reproducible. */
const scoreFor = (judgeIndex: number, teamIndex: number, criterionIndex: number): number => {
  const seed = (judgeIndex + 1) * 31 + (teamIndex + 1) * 17 + (criterionIndex + 1) * 7;
  const spread = (seed * 2654435761) % 23;
  const base = [CHOREO, EXECUTION, MUSICALITY][criterionIndex]!.maxPoints;
  return Math.max(0, base - spread);
};

const buildInput = (): TabulationInput => {
  const scores: ScoreInput[] = [];
  JUDGES.forEach((judgeId, j) =>
    TEAMS.forEach((teamId, t) =>
      [CHOREO, EXECUTION, MUSICALITY].forEach((criterion, c) =>
        scores.push({ judgeId, teamId, criterionId: criterion.id, rawValue: scoreFor(j, t, c) }),
      ),
    ),
  );

  return {
    teams: TEAMS,
    judges: JUDGES,
    scores,
    deductions: [{ teamId: "bid-03", points: 2, reason: "exceeded time limit by 14s" }],
  };
};

/** What a `tab_runs` row holds: the frozen inputs, the rubric, and the computed results. */
type Snapshot = { inputs: TabulationInput; config: Rubric; results: TabulationResult };

const lock = (): Snapshot => {
  const inputs = buildInput();
  return { inputs, config: RUBRIC, results: tabulate(inputs, RUBRIC) };
};

/** Round-trips through JSON exactly as Postgres `jsonb` would. */
const persist = (snapshot: Snapshot): Snapshot => JSON.parse(JSON.stringify(snapshot)) as Snapshot;

describe("reproducibility of locked results", () => {
  it("re-running tabulate on a persisted snapshot reproduces its results exactly", () => {
    const stored = persist(lock());

    const recomputed = tabulate(stored.inputs, stored.config);

    expect(recomputed).toEqual(stored.results);
  });

  it("reproduces every placement's aggregate bit-for-bit, not merely to a tolerance", () => {
    const stored = persist(lock());
    const recomputed = tabulate(stored.inputs, stored.config);

    for (const placement of stored.results.placements) {
      const fresh = recomputed.placements.find((p) => p.teamId === placement.teamId);
      expect(Object.is(fresh!.aggregate, placement.aggregate)).toBe(true);
    }
  });

  it("reproduces results even when the stored scores come back in a different row order", () => {
    const stored = persist(lock());
    const reordered = { ...stored.inputs, scores: [...stored.inputs.scores].reverse() };

    expect(tabulate(reordered, stored.config)).toEqual(stored.results);
  });

  it("produces a placement for every team, and the places run 1..n", () => {
    const { results } = lock();

    expect(results.placements).toHaveLength(TEAMS.length);
    expect(results.unscored).toEqual([]);
    expect(results.placements.map((p) => p.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("detects tampering: changing one raw score changes the locked result", () => {
    const stored = persist(lock());
    const tampered = {
      ...stored.inputs,
      scores: stored.inputs.scores.map((s, i) => (i === 0 ? { ...s, rawValue: s.rawValue - 1 } : s)),
    };

    expect(tabulate(tampered, stored.config)).not.toEqual(stored.results);
  });

  it("detects tampering: dropping a deduction changes the locked result", () => {
    const stored = persist(lock());
    const tampered = { ...stored.inputs, deductions: [] };

    expect(tabulate(tampered, stored.config)).not.toEqual(stored.results);
  });
});
