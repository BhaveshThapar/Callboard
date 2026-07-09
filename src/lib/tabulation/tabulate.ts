import { criterionMeans, deductionsByTeam, judgeCounts, judgeTeamTotals } from "./aggregate";
import { normalize } from "./normalize";
import { rankTeams } from "./rank";
import type { Rubric, TabulationInput, TabulationResult } from "./types";

/**
 * Pure. Imports nothing from the database, reads no clock, draws no randomness.
 * The same input and rubric always produce a byte-identical result, which is what
 * makes a locked `tab_runs` snapshot reproducible the next day.
 */
export const tabulate = (input: TabulationInput, rubric: Rubric): TabulationResult => {
  const totals = judgeTeamTotals(input, rubric);
  const counts = judgeCounts(totals);
  const aggregates = normalize(totals, rubric.normalization);

  const { placements, unresolvedTies } = rankTeams(
    aggregates,
    deductionsByTeam(input.deductions),
    counts,
    rubric.tiebreakers,
    { judgeTotals: totals, criterionMeans: criterionMeans(input) },
  );

  const unscored = input.teams
    .filter((teamId) => !aggregates.has(teamId))
    .sort((a, b) => a.localeCompare(b));

  return { method: rubric.normalization, placements, unscored, unresolvedTies };
};
