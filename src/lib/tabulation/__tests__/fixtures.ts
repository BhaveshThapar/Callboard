import type { Criterion, Rubric, ScoreInput, TabulationResult, Tiebreaker } from "../types";
import type { NormalizationMethod } from "../types";

export const CHOREO: Criterion = { id: "c1", label: "Choreography", maxPoints: 60, weightBp: 10_000, sortOrder: 0 };
export const EXECUTION: Criterion = { id: "c2", label: "Execution", maxPoints: 40, weightBp: 10_000, sortOrder: 1 };

export const rubric = (
  normalization: NormalizationMethod,
  tiebreakers: Tiebreaker[] = [],
  criteria: Criterion[] = [CHOREO, EXECUTION],
): Rubric => ({ id: "r1", normalization, criteria, tiebreakers });

/** `scores[judgeId][teamId]` = one raw value per criterion, in the order given. */
export const scoresFrom = (
  table: Record<string, Record<string, number[]>>,
  criteria: Criterion[] = [CHOREO, EXECUTION],
): ScoreInput[] => {
  const scores: ScoreInput[] = [];
  for (const [judgeId, byTeam] of Object.entries(table)) {
    for (const [teamId, values] of Object.entries(byTeam)) {
      values.forEach((rawValue, i) => {
        const criterion = criteria[i];
        if (criterion) scores.push({ judgeId, teamId, criterionId: criterion.id, rawValue });
      });
    }
  }
  return scores;
};

export const placementOf = (result: TabulationResult, teamId: string) => {
  const placement = result.placements.find((p) => p.teamId === teamId);
  if (!placement) throw new Error(`no placement for ${teamId}`);
  return placement;
};

export const orderOf = (result: TabulationResult): string[] =>
  result.placements.map((p) => p.teamId);
