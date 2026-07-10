import { eq } from "drizzle-orm";
import { db } from "@/db";
import { judgeNotes } from "@/db/schema";
import type { BoardActor } from "@/lib/auth/scope";
import { noteKey } from "@/lib/export/feedback";

/** One judge's own notes, for prefilling their form. teamId -> note. */
export const notesForJudge = async (judgeAssignmentId: string): Promise<Map<string, string>> => {
  const rows = await db
    .select({ teamId: judgeNotes.teamId, note: judgeNotes.note })
    .from(judgeNotes)
    .where(eq(judgeNotes.judgeAssignmentId, judgeAssignmentId));

  return new Map(rows.map((row) => [row.teamId, row.note]));
};

/** Every note in the comp, keyed `judgeAssignmentId:teamId`. Scoped by the board's own comp. */
export const notesForBoard = async (actor: BoardActor): Promise<Map<string, string>> => {
  const rows = await db
    .select({
      judgeAssignmentId: judgeNotes.judgeAssignmentId,
      teamId: judgeNotes.teamId,
      note: judgeNotes.note,
    })
    .from(judgeNotes)
    .where(eq(judgeNotes.compId, actor.compId));

  return new Map(rows.map((row) => [noteKey(row.judgeAssignmentId, row.teamId), row.note]));
};
