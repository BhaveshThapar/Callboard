import type { DeductionInput, Rubric, ScoreInput, TabulationInput } from "./types";

/** judgeId -> teamId -> weighted total, with the team's deduction already subtracted. */
export type JudgeTotals = Map<string, Map<string, number>>;

/** teamId -> criterionId -> mean raw value across the judges who scored it. */
export type CriterionMeans = Map<string, Map<string, number>>;

/**
 * Float addition is not associative, and Postgres makes no promise about row order.
 * Summing in a canonical order is what keeps a re-run of a locked snapshot bit-identical.
 */
const canonical = (scores: readonly ScoreInput[]): ScoreInput[] =>
  [...scores].sort(
    (a, b) =>
      a.judgeId.localeCompare(b.judgeId) ||
      a.teamId.localeCompare(b.teamId) ||
      a.criterionId.localeCompare(b.criterionId),
  );

export const deductionsByTeam = (deductions: readonly DeductionInput[]): Map<string, number> => {
  const ordered = [...deductions].sort(
    (a, b) => a.teamId.localeCompare(b.teamId) || a.points - b.points || a.reason.localeCompare(b.reason),
  );
  const byTeam = new Map<string, number>();
  for (const d of ordered) {
    byTeam.set(d.teamId, (byTeam.get(d.teamId) ?? 0) + d.points);
  }
  return byTeam;
};

/**
 * Deductions are subtracted from every judge's total for that team, before normalization.
 * For `raw` this is identical to subtracting from the team's mean, because the mean is affine.
 * For `zscore` and `rank` it is the only well-defined choice: those aggregates are measured in
 * standard deviations and rank positions, not points, so a point penalty cannot be applied to them.
 */
export const judgeTeamTotals = (input: TabulationInput, rubric: Rubric): JudgeTotals => {
  const weightOf = new Map(rubric.criteria.map((c) => [c.id, c.weightBp]));
  const totals: JudgeTotals = new Map();

  for (const score of canonical(input.scores)) {
    const weightBp = weightOf.get(score.criterionId);
    if (weightBp === undefined) continue;

    let byTeam = totals.get(score.judgeId);
    if (!byTeam) {
      byTeam = new Map();
      totals.set(score.judgeId, byTeam);
    }
    const contribution = (score.rawValue * weightBp) / 10_000;
    byTeam.set(score.teamId, (byTeam.get(score.teamId) ?? 0) + contribution);
  }

  const deductions = deductionsByTeam(input.deductions);
  for (const byTeam of totals.values()) {
    for (const [teamId, total] of byTeam) {
      const penalty = deductions.get(teamId);
      if (penalty) byTeam.set(teamId, total - penalty);
    }
  }

  return totals;
};

export const criterionMeans = (input: TabulationInput): CriterionMeans => {
  const sums = new Map<string, Map<string, { sum: number; n: number }>>();

  for (const score of canonical(input.scores)) {
    let byCriterion = sums.get(score.teamId);
    if (!byCriterion) {
      byCriterion = new Map();
      sums.set(score.teamId, byCriterion);
    }
    const acc = byCriterion.get(score.criterionId) ?? { sum: 0, n: 0 };
    byCriterion.set(score.criterionId, { sum: acc.sum + score.rawValue, n: acc.n + 1 });
  }

  const means: CriterionMeans = new Map();
  for (const [teamId, byCriterion] of sums) {
    const teamMeans = new Map<string, number>();
    for (const [criterionId, { sum, n }] of byCriterion) {
      teamMeans.set(criterionId, sum / n);
    }
    means.set(teamId, teamMeans);
  }
  return means;
};

export const judgeCounts = (totals: JudgeTotals): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const byTeam of totals.values()) {
    for (const teamId of byTeam.keys()) {
      counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
    }
  }
  return counts;
};
