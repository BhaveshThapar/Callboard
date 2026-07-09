import { and, count, eq, isNull, max } from "drizzle-orm";
import { db } from "@/db";
import { judgeAssignments, people, scores } from "@/db/schema";
import type { BoardActor } from "@/lib/auth/scope";
import { listTeamsForBoard } from "@/lib/auth/scope";
import type { NormalizationMethod } from "@/lib/tabulation/types";
import { getRubric, latestLockedRun, liveStandings, reproduce } from "./tab";

export type StandingRow = {
  place: number;
  teamId: string;
  label: string;
  bidCode: string;
  aggregate: number;
  deductionPoints: number;
  judgeCount: number;
  tiedWith: string[];
  resolvedBy: string | null;
};

export type JudgeProgress = { name: string; submitted: number; expected: number };

export type BoardSnapshot = {
  compName: string;
  method: NormalizationMethod;
  locked: boolean;
  lockedAt: string | null;
  /** Whether re-running `tabulate()` on the locked snapshot reproduces the stored result. */
  reproduces: boolean | null;
  overrideReason: string | null;
  judges: JudgeProgress[];
  scoresSubmitted: number;
  scoresExpected: number;
  lastScoreAt: string | null;
  standings: StandingRow[];
  unscored: string[];
  unresolvedTies: string[][];
};

/**
 * Before the lock, the board sees bid codes — the same blind view the judges have.
 * After the lock, names are revealed and the numbers come from the frozen snapshot,
 * never from a fresh computation.
 */
export const boardSnapshot = async (actor: BoardActor): Promise<BoardSnapshot> => {
  const [teams, rubric, locked, progress, roster, perJudge] = await Promise.all([
    listTeamsForBoard(actor),
    getRubric(actor.compId),
    latestLockedRun(actor.compId),
    db
      .select({ submitted: count(), lastAt: max(scores.submittedAt) })
      .from(scores)
      .where(eq(scores.compId, actor.compId)),
    db
      .select({ id: judgeAssignments.id, name: people.name })
      .from(judgeAssignments)
      .innerJoin(people, eq(people.id, judgeAssignments.personId))
      .where(and(eq(judgeAssignments.compId, actor.compId), isNull(judgeAssignments.revokedAt)))
      .orderBy(people.name),
    db
      .select({ judgeAssignmentId: scores.judgeAssignmentId, submitted: count() })
      .from(scores)
      .where(eq(scores.compId, actor.compId))
      .groupBy(scores.judgeAssignmentId),
  ]);

  const results = locked ? locked.results : await liveStandings(actor.compId);
  const verification = locked ? reproduce(locked) : null;

  const byId = new Map(teams.map((t) => [t.id, t]));
  const label = (teamId: string): string => {
    const team = byId.get(teamId);
    if (!team) return teamId;
    return locked ? team.name : team.bidCode;
  };

  const row = progress[0];
  const expectedPerJudge = teams.length * rubric.criteria.length;
  const submittedByJudge = new Map(perJudge.map((j) => [j.judgeAssignmentId, j.submitted]));
  const judges = roster.map((judge) => ({
    name: judge.name,
    submitted: submittedByJudge.get(judge.id) ?? 0,
    expected: expectedPerJudge,
  }));

  return {
    compName: actor.compName,
    method: results.method,
    locked: locked !== null,
    lockedAt: locked?.lockedAt.toISOString() ?? null,
    reproduces: verification?.matches ?? null,
    overrideReason: locked?.overrideReason ?? null,
    judges,
    scoresSubmitted: row?.submitted ?? 0,
    scoresExpected: expectedPerJudge * judges.length,
    lastScoreAt: row?.lastAt ? new Date(row.lastAt).toISOString() : null,
    standings: results.placements.map((placement) => ({
      place: placement.place,
      teamId: placement.teamId,
      label: label(placement.teamId),
      bidCode: byId.get(placement.teamId)?.bidCode ?? "—",
      aggregate: placement.aggregate,
      deductionPoints: placement.deductionPoints,
      judgeCount: placement.judgeCount,
      tiedWith: placement.tiedWith.map(label),
      resolvedBy: placement.resolvedBy,
    })),
    unscored: results.unscored.map(label),
    unresolvedTies: results.unresolvedTies.map((group) => group.map(label)),
  };
};
