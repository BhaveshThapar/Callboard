import type { CriterionMeans, JudgeTotals } from "./aggregate";
import type { Placement, Tiebreaker } from "./types";

/** Two aggregates closer than this are treated as tied rather than separated by float noise. */
const EPSILON = 1e-9;

export type TiebreakContext = {
  judgeTotals: JudgeTotals;
  criterionMeans: CriterionMeans;
};

type Block = { teams: string[]; resolvedBy: Tiebreaker["kind"] | null };

const highestSingleJudge = (team: string, ctx: TiebreakContext): number => {
  let best = Number.NEGATIVE_INFINITY;
  for (const byTeam of ctx.judgeTotals.values()) {
    const total = byTeam.get(team);
    if (total !== undefined && total > best) best = total;
  }
  return best === Number.NEGATIVE_INFINITY ? 0 : best;
};

/** Copeland score within the tied group: +1 for each rival more judges preferred, -1 for each rival they didn't. */
const headToHead = (team: string, group: string[], ctx: TiebreakContext): number => {
  let copeland = 0;
  for (const rival of group) {
    if (rival === team) continue;
    let wins = 0;
    let losses = 0;
    for (const byTeam of ctx.judgeTotals.values()) {
      const ours = byTeam.get(team);
      const theirs = byTeam.get(rival);
      if (ours === undefined || theirs === undefined) continue;
      if (ours > theirs) wins++;
      else if (theirs > ours) losses++;
    }
    copeland += Math.sign(wins - losses);
  }
  return copeland;
};

const tiebreakKey = (
  tiebreaker: Tiebreaker,
  team: string,
  group: string[],
  ctx: TiebreakContext,
): number => {
  switch (tiebreaker.kind) {
    case "criterion":
      return ctx.criterionMeans.get(team)?.get(tiebreaker.criterionId) ?? 0;
    case "highest_single_judge":
      return highestSingleJudge(team, ctx);
    case "head_to_head":
      return headToHead(team, group, ctx);
  }
};

/** Splits a group into descending-key subgroups. One subgroup back means the tiebreaker found nothing. */
const splitByKey = (
  group: string[],
  tiebreaker: Tiebreaker,
  ctx: TiebreakContext,
): string[][] => {
  const keyed = group
    .map((team) => ({ team, key: tiebreakKey(tiebreaker, team, group, ctx) }))
    .sort((a, b) => b.key - a.key || a.team.localeCompare(b.team));

  const subgroups: { teams: string[]; key: number }[] = [];
  for (const { team, key } of keyed) {
    const last = subgroups.at(-1);
    if (last && Math.abs(last.key - key) <= EPSILON) last.teams.push(team);
    else subgroups.push({ teams: [team], key });
  }
  return subgroups.map((s) => s.teams);
};

const resolve = (
  group: string[],
  tiebreakers: Tiebreaker[],
  ctx: TiebreakContext,
  resolvedBy: Tiebreaker["kind"] | null,
): Block[] => {
  if (group.length === 1) return [{ teams: group, resolvedBy }];
  if (tiebreakers.length === 0) {
    return [{ teams: [...group].sort((a, b) => a.localeCompare(b)), resolvedBy: null }];
  }

  const [tiebreaker, ...rest] = tiebreakers as [Tiebreaker, ...Tiebreaker[]];
  const subgroups = splitByKey(group, tiebreaker, ctx);

  if (subgroups.length === 1) return resolve(group, rest, ctx, resolvedBy);

  return subgroups.flatMap((subgroup) =>
    resolve(subgroup, rest, ctx, subgroup.length === 1 ? tiebreaker.kind : resolvedBy),
  );
};

export const rankTeams = (
  aggregates: Map<string, number>,
  deductions: Map<string, number>,
  counts: Map<string, number>,
  tiebreakers: Tiebreaker[],
  ctx: TiebreakContext,
): { placements: Placement[]; unresolvedTies: string[][] } => {
  const sorted = [...aggregates.entries()].sort(
    ([aId, aAgg], [bId, bAgg]) => bAgg - aAgg || aId.localeCompare(bId),
  );

  const tiedGroups: string[][] = [];
  for (const [teamId, aggregate] of sorted) {
    const last = tiedGroups.at(-1);
    const lastAggregate = last ? aggregates.get(last[0]!)! : undefined;
    if (last && lastAggregate !== undefined && Math.abs(lastAggregate - aggregate) <= EPSILON) {
      last.push(teamId);
    } else {
      tiedGroups.push([teamId]);
    }
  }

  const blocks = tiedGroups.flatMap((group) => resolve(group, tiebreakers, ctx, null));

  const placements: Placement[] = [];
  let placed = 0;
  for (const block of blocks) {
    const place = placed + 1;
    for (const teamId of block.teams) {
      placements.push({
        teamId,
        place,
        aggregate: aggregates.get(teamId)!,
        deductionPoints: deductions.get(teamId) ?? 0,
        judgeCount: counts.get(teamId) ?? 0,
        tiedWith: block.teams.filter((t) => t !== teamId),
        resolvedBy: block.resolvedBy,
      });
    }
    placed += block.teams.length;
  }

  return {
    placements,
    unresolvedTies: blocks.filter((b) => b.teams.length > 1).map((b) => b.teams),
  };
};
