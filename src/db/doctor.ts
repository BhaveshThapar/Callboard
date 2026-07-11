import { and, eq, isNull } from "drizzle-orm";
import type { BoardActor, JudgeActor } from "@/lib/auth/scope";
import { boardSnapshot } from "@/lib/comp/board";
import { judgeSnapshot } from "@/lib/comp/judge";
import type { CompConfig } from "./config";
import { summarizeHealth } from "./health";
import type { DemoHealth } from "./health";
import { db } from "./index";
import { boardAssignments, comps, judgeAssignments, orgs, people, teams } from "./schema";

/**
 * Is the seeded demo one a prospect can actually be shown? A comp seeded under an older schema can
 * carry a dead board link while the judge links still resolve -- the failure surfaces only when the
 * board link is opened, mid-call. This checks the property that breaks (a board link resolves and
 * the board view renders), not migration-file hashes. It only reads, so it is safe against `main`.
 */
export const checkDemoHealth = async (config: CompConfig): Promise<DemoHealth> => {
  const [comp] = await db
    .select({ id: comps.id, name: comps.name })
    .from(comps)
    .innerJoin(orgs, eq(orgs.id, comps.orgId))
    .where(and(eq(orgs.slug, config.org.slug), eq(comps.slug, config.comp.slug)))
    .limit(1);

  if (!comp) {
    return summarizeHealth(
      {
        compFound: false,
        boardAssignments: 0,
        boardName: null,
        boardViewLoaded: false,
        judges: 0,
        judgeViewLoaded: false,
        teams: 0,
      },
      { judges: config.judges.length, teams: config.teams.length },
    );
  }

  // The same join `resolveBoardActor` does, without the token filter: does *any* live board link
  // resolve to a person? Zero rows is the dropped-column footgun.
  const board = await db
    .select({ assignmentId: boardAssignments.id, personId: people.id, personName: people.name })
    .from(boardAssignments)
    .innerJoin(people, eq(people.id, boardAssignments.personId))
    .where(and(eq(boardAssignments.compId, comp.id), isNull(boardAssignments.revokedAt)));

  let boardViewLoaded = false;
  const first = board[0];
  if (first) {
    const actor: BoardActor = {
      kind: "board",
      compId: comp.id,
      compName: comp.name,
      personId: first.personId,
      personName: first.personName,
      boardAssignmentId: first.assignmentId,
    };
    try {
      await boardSnapshot(actor);
      boardViewLoaded = true;
    } catch {
      boardViewLoaded = false;
    }
  }

  // The judge page assembles its own data (judge_snapshot), including `judge_notes` that the board
  // never reads — the same drift class as the dropped board column, on a table the board check misses.
  // The join mirrors `resolveJudgeActor` without the token filter, and doubles as the judge count.
  const judges = await db
    .select({ assignmentId: judgeAssignments.id, personId: people.id, personName: people.name })
    .from(judgeAssignments)
    .innerJoin(people, eq(people.id, judgeAssignments.personId))
    .where(and(eq(judgeAssignments.compId, comp.id), isNull(judgeAssignments.revokedAt)));

  let judgeViewLoaded = false;
  const firstJudge = judges[0];
  if (firstJudge) {
    const actor: JudgeActor = {
      kind: "judge",
      compId: comp.id,
      compName: comp.name,
      personId: firstJudge.personId,
      judgeName: firstJudge.personName,
      judgeAssignmentId: firstJudge.assignmentId,
    };
    try {
      await judgeSnapshot(actor);
      judgeViewLoaded = true;
    } catch {
      judgeViewLoaded = false;
    }
  }

  const roster = await db.select({ id: teams.id }).from(teams).where(eq(teams.compId, comp.id));

  return summarizeHealth(
    {
      compFound: true,
      boardAssignments: board.length,
      boardName: first?.personName ?? null,
      boardViewLoaded,
      judges: judges.length,
      judgeViewLoaded,
      teams: roster.length,
    },
    { judges: config.judges.length, teams: config.teams.length },
  );
};
