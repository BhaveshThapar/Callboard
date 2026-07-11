"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { judgeNotes, scores } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { listTeamsForJudge, resolveJudgeActor } from "@/lib/auth/scope";
import { getRubric, latestLockedRun } from "@/lib/comp/tab";
import type { SubmitState } from "./state";

export const submitScores = async (
  _previous: SubmitState,
  formData: FormData,
): Promise<SubmitState> => {
  const token = String(formData.get("token") ?? "");
  const teamId = String(formData.get("teamId") ?? "");

  const actor = await resolveJudgeActor(token);
  if (!actor) return { status: "error", message: "This scoring link is no longer valid." };

  if (await latestLockedRun(actor.compId)) {
    return { status: "error", message: "Results are locked. Scores can no longer be changed." };
  }

  // `teamId` arrives from the form, so it is the judge's claim and not a fact. A score row carries a
  // bare team FK, so the database would accept one naming another comp's team -- and the tabulator
  // would rank it here. Check it against the same scoped read the judge's own team list came from.
  const scoreable = await listTeamsForJudge(actor);
  if (!scoreable.some((team) => team.id === teamId)) {
    return { status: "error", message: "That team is not competing in this comp." };
  }

  const rubric = await getRubric(actor.compId);
  const rows = [];

  for (const criterion of rubric.criteria) {
    const entry = formData.get(`criterion:${criterion.id}`);
    if (entry === null || entry === "") {
      return { status: "error", message: `${criterion.label} is missing a score.` };
    }

    const rawValue = Number(entry);
    if (!Number.isInteger(rawValue) || rawValue < 0 || rawValue > criterion.maxPoints) {
      return {
        status: "error",
        message: `${criterion.label} must be a whole number from 0 to ${criterion.maxPoints}.`,
      };
    }

    rows.push({
      compId: actor.compId,
      judgeAssignmentId: actor.judgeAssignmentId,
      teamId,
      criterionId: criterion.id,
      rawValue,
    });
  }

  await db
    .insert(scores)
    .values(rows)
    .onConflictDoUpdate({
      target: [scores.judgeAssignmentId, scores.teamId, scores.criterionId],
      set: { rawValue: sql`excluded.raw_value`, submittedAt: new Date() },
    });

  await recordAudit({
    compId: actor.compId,
    actorKind: "judge",
    actorPersonId: actor.personId,
    action: "score.submit",
    entity: "team",
    entityId: teamId,
    after: Object.fromEntries(rows.map((r) => [r.criterionId, r.rawValue])),
  });

  revalidatePath(`/judge/${token}`);
  return { status: "saved" };
};

/**
 * Written feedback for one team. Kept off the score path so `score.submit` keeps its exact audit
 * shape, and kept out of tabulation entirely: a note never moves a placement.
 *
 * Notes close when scoring closes. A judge who wants to revise their feedback after the lock is in
 * the same position as one who wants to revise a score, and for the same reason.
 */
export const submitNote = async (
  _previous: SubmitState,
  formData: FormData,
): Promise<SubmitState> => {
  const token = String(formData.get("token") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const actor = await resolveJudgeActor(token);
  if (!actor) return { status: "error", message: "This scoring link is no longer valid." };

  if (await latestLockedRun(actor.compId)) {
    return { status: "error", message: "Results are locked. Feedback can no longer be changed." };
  }
  if (!teamId) return { status: "error", message: "Missing team." };
  if (!note) return { status: "error", message: "Write something, or leave the note empty." };

  const scoreable = await listTeamsForJudge(actor);
  if (!scoreable.some((team) => team.id === teamId)) {
    return { status: "error", message: "That team is not competing in this comp." };
  }

  await db
    .insert(judgeNotes)
    .values({
      compId: actor.compId,
      judgeAssignmentId: actor.judgeAssignmentId,
      teamId,
      note,
    })
    .onConflictDoUpdate({
      target: [judgeNotes.judgeAssignmentId, judgeNotes.teamId],
      set: { note: sql`excluded.note`, submittedAt: new Date() },
    });

  await recordAudit({
    compId: actor.compId,
    actorKind: "judge",
    actorPersonId: actor.personId,
    action: "note.submit",
    entity: "team",
    entityId: teamId,
  });

  revalidatePath(`/judge/${token}`);
  return { status: "saved" };
};
