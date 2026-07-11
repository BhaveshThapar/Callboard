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
  // `teams` is the roster of record; `scores` is only evidence about it. A score outlives the team's
  // place in the comp -- withdraw a team and its rows remain -- and ranking is driven by the
  // aggregates, so an unfiltered score places a team the comp no longer lists, above the ones it
  // does. Enforced here rather than only at the query that loads them, because this function must
  // hold its contract for any input it is handed, including a snapshot replayed a year later.
  const competing = new Set(input.teams);
  const scoped: TabulationInput = {
    ...input,
    scores: input.scores.filter((score) => competing.has(score.teamId)),
    deductions: input.deductions.filter((deduction) => competing.has(deduction.teamId)),
  };

  const totals = judgeTeamTotals(scoped, rubric);
  const counts = judgeCounts(totals);
  const aggregates = normalize(totals, rubric.normalization);

  const { placements, unresolvedTies } = rankTeams(
    aggregates,
    deductionsByTeam(scoped.deductions),
    counts,
    rubric.tiebreakers,
    { judgeTotals: totals, criterionMeans: criterionMeans(scoped) },
  );

  const unscored = scoped.teams
    .filter((teamId) => !aggregates.has(teamId))
    .sort((a, b) => a.localeCompare(b));

  return { method: rubric.normalization, placements, unscored, unresolvedTies };
};
