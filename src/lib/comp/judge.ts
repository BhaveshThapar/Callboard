import { listTeamsForJudge } from "@/lib/auth/scope";
import type { JudgeActor, JudgeTeamView } from "@/lib/auth/scope";
import type { Rubric } from "@/lib/tabulation/types";
import { notesForJudge } from "./feedback";
import { getRubric, judgeScores, latestLockedRun } from "./tab";
import type { LockedRun } from "./tab";

/**
 * Everything a judge's phone renders, in one call. The demo preflight loads this so it exercises
 * exactly what the page does — including `judge_notes`, which the board view never touches — and
 * the two cannot drift apart. Reads `judge_notes` for display only; nothing here feeds tabulation.
 */
export type JudgeSnapshot = {
  teams: JudgeTeamView[];
  rubric: Rubric;
  scores: Map<string, Map<string, number>>;
  notes: Map<string, string>;
  locked: LockedRun | null;
};

export const judgeSnapshot = async (actor: JudgeActor): Promise<JudgeSnapshot> => {
  const [teams, rubric, scores, notes, locked] = await Promise.all([
    listTeamsForJudge(actor),
    getRubric(actor.compId),
    judgeScores(actor.judgeAssignmentId),
    notesForJudge(actor.judgeAssignmentId),
    latestLockedRun(actor.compId),
  ]);

  return { teams, rubric, scores, notes, locked };
};
