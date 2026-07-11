import { and, eq, isNull, inArray } from "drizzle-orm";
import { db } from "@/db";
import { boardAssignments, comps, judgeAssignments, people, SCOREABLE_STATUSES, teams } from "@/db/schema";
import type { JudgeLabelView } from "./labels";
import { judgeLabel } from "./labels";
import { hashToken } from "./token";

/** `personId` is not optional: an unattributed lock is the thing PRD B6 forbids. */
export type BoardActor = {
  kind: "board";
  compId: string;
  compName: string;
  personId: string;
  personName: string;
  boardAssignmentId: string;
};
export type JudgeActor = {
  kind: "judge";
  compId: string;
  compName: string;
  personId: string;
  judgeName: string;
  judgeAssignmentId: string;
};
export type Actor = BoardActor | JudgeActor;

/** Teams a judge is allowed to see. Note the absence of `name`: blindness is enforced by the type. */
export type JudgeTeamView = { id: string; bidCode: string; performanceOrder: number | null };
export type BoardTeamView = JudgeTeamView & { name: string; school: string | null };

/**
 * The board's window onto a judge's *identity*. The board recruited these people, sends them their
 * links, and chases the slow ones, so it sees the name — but only ever beside a submission count,
 * never beside a score or a note.
 */
export type BoardJudgeView = { assignmentId: string; name: string; revokedAt: Date | null };

export type { JudgeLabelView } from "./labels";

const SCOREABLE = SCOREABLE_STATUSES;

export const resolveBoardActor = async (token: string): Promise<BoardActor | null> => {
  const [row] = await db
    .select({
      assignmentId: boardAssignments.id,
      compId: comps.id,
      compName: comps.name,
      personId: people.id,
      personName: people.name,
    })
    .from(boardAssignments)
    .innerJoin(comps, eq(comps.id, boardAssignments.compId))
    .innerJoin(people, eq(people.id, boardAssignments.personId))
    .where(
      and(eq(boardAssignments.tokenHash, hashToken(token)), isNull(boardAssignments.revokedAt)),
    )
    .limit(1);

  if (!row) return null;
  return {
    kind: "board",
    compId: row.compId,
    compName: row.compName,
    personId: row.personId,
    personName: row.personName,
    boardAssignmentId: row.assignmentId,
  };
};

export const resolveJudgeActor = async (token: string): Promise<JudgeActor | null> => {
  const [row] = await db
    .select({
      assignmentId: judgeAssignments.id,
      compId: comps.id,
      compName: comps.name,
      personId: people.id,
      judgeName: people.name,
    })
    .from(judgeAssignments)
    .innerJoin(comps, eq(comps.id, judgeAssignments.compId))
    .innerJoin(people, eq(people.id, judgeAssignments.personId))
    .where(
      and(eq(judgeAssignments.tokenHash, hashToken(token)), isNull(judgeAssignments.revokedAt)),
    )
    .limit(1);

  if (!row) return null;
  return {
    kind: "judge",
    compId: row.compId,
    compName: row.compName,
    personId: row.personId,
    judgeName: row.judgeName,
    judgeAssignmentId: row.assignmentId,
  };
};

/** The judge's window onto `teams`. Never selects the team name. */
export const listTeamsForJudge = (actor: JudgeActor): Promise<JudgeTeamView[]> =>
  db
    .select({
      id: teams.id,
      bidCode: teams.bidCode,
      performanceOrder: teams.performanceOrder,
    })
    .from(teams)
    .where(and(eq(teams.compId, actor.compId), inArray(teams.status, [...SCOREABLE])))
    .orderBy(teams.performanceOrder, teams.bidCode);

/** The board's window onto the same rows. */
export const listTeamsForBoard = (actor: BoardActor): Promise<BoardTeamView[]> =>
  db
    .select({
      id: teams.id,
      bidCode: teams.bidCode,
      performanceOrder: teams.performanceOrder,
      name: teams.name,
      school: teams.school,
    })
    .from(teams)
    .where(and(eq(teams.compId, actor.compId), inArray(teams.status, [...SCOREABLE])))
    .orderBy(teams.performanceOrder, teams.bidCode);

/**
 * Every judge of the board's comp, revoked ones included — the caller decides what to do with them.
 * For the roster sidebar only: pairing this with a score or a note is what `listJudgeLabelsForBoard`
 * exists to prevent.
 */
export const listJudgesForBoard = (actor: BoardActor): Promise<BoardJudgeView[]> =>
  db
    .select({
      assignmentId: judgeAssignments.id,
      name: people.name,
      revokedAt: judgeAssignments.revokedAt,
    })
    .from(judgeAssignments)
    .innerJoin(people, eq(people.id, judgeAssignments.personId))
    .where(eq(judgeAssignments.compId, actor.compId))
    .orderBy(people.name);

/**
 * The same judges, de-identified. Revoked ones included: their scores still counted, so they still
 * need a label in the export. `people` is not joined at all — the name is not dropped downstream,
 * it is never read.
 */
export const listJudgeLabelsForBoard = async (actor: BoardActor): Promise<JudgeLabelView[]> => {
  const rows = await db
    .select({ assignmentId: judgeAssignments.id, labelSeq: judgeAssignments.labelSeq })
    .from(judgeAssignments)
    .where(eq(judgeAssignments.compId, actor.compId))
    .orderBy(judgeAssignments.labelSeq);

  return rows.map((row) => ({ assignmentId: row.assignmentId, label: judgeLabel(row.labelSeq) }));
};
