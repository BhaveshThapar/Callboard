import type { JudgeTotals } from "./aggregate";
import type { NormalizationMethod } from "./types";

const mean = (values: number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

/** Population standard deviation. Zero when a judge gave every team the same total. */
const populationStdev = (values: number[]): number => {
  if (values.length === 0) return 0;
  const mu = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - mu) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

/**
 * Fractional ranks, 1 = best. Teams a judge scored equally share the average of the
 * positions they occupy, so the ranks a judge hands out always sum to n(n+1)/2.
 */
const fractionalRanks = (totals: Map<string, number>): Map<string, number> => {
  const sorted = [...totals.entries()].sort(
    ([aId, aTotal], [bId, bTotal]) => bTotal - aTotal || aId.localeCompare(bId),
  );

  const ranks = new Map<string, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]![1] === sorted[i]![1]) j++;
    const averageRank = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k++) ranks.set(sorted[k]![0], averageRank);
    i = j + 1;
  }
  return ranks;
};

/** Per judge, z = (total - judgeMean) / judgeStdev. A judge with zero spread contributes 0. */
const zScoresByJudge = (totals: JudgeTotals): JudgeTotals => {
  const zs: JudgeTotals = new Map();
  for (const [judgeId, byTeam] of totals) {
    const values = [...byTeam.values()];
    const mu = mean(values);
    const sigma = populationStdev(values);
    const byTeamZ = new Map<string, number>();
    for (const [teamId, total] of byTeam) {
      byTeamZ.set(teamId, sigma === 0 ? 0 : (total - mu) / sigma);
    }
    zs.set(judgeId, byTeamZ);
  }
  return zs;
};

const meanAcrossJudges = (perJudge: JudgeTotals): Map<string, number> => {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const byTeam of perJudge.values()) {
    for (const [teamId, value] of byTeam) {
      const acc = sums.get(teamId) ?? { sum: 0, n: 0 };
      sums.set(teamId, { sum: acc.sum + value, n: acc.n + 1 });
    }
  }
  const means = new Map<string, number>();
  for (const [teamId, { sum, n }] of sums) means.set(teamId, sum / n);
  return means;
};

/**
 * Collapses per-judge totals into one aggregate per team. Higher is always better,
 * including for `rank`, where the negated mean rank is returned so the ordering
 * convention holds across all three methods.
 */
export const normalize = (
  totals: JudgeTotals,
  method: NormalizationMethod,
): Map<string, number> => {
  switch (method) {
    case "raw":
      return meanAcrossJudges(totals);

    case "zscore":
      return meanAcrossJudges(zScoresByJudge(totals));

    case "rank": {
      const perJudgeRanks: JudgeTotals = new Map();
      for (const [judgeId, byTeam] of totals) {
        perJudgeRanks.set(judgeId, fractionalRanks(byTeam));
      }
      const meanRanks = meanAcrossJudges(perJudgeRanks);
      const negated = new Map<string, number>();
      for (const [teamId, meanRank] of meanRanks) negated.set(teamId, -meanRank);
      return negated;
    }
  }
};
