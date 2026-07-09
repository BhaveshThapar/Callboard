import { and, eq, isNull, inArray } from "drizzle-orm";
import { db } from "@/db";
import { comps, judgeAssignments, people, teams } from "@/db/schema";
import { hashToken } from "./token";

export type BoardActor = { kind: "board"; compId: string; compName: string };
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

const SCOREABLE = ["accepted", "competing"] as const;

export const resolveBoardActor = async (token: string): Promise<BoardActor | null> => {
  const [comp] = await db
    .select({ id: comps.id, name: comps.name })
    .from(comps)
    .where(eq(comps.boardTokenHash, hashToken(token)))
    .limit(1);

  return comp ? { kind: "board", compId: comp.id, compName: comp.name } : null;
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
