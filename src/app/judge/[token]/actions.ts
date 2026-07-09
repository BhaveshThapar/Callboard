"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { scores } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { resolveJudgeActor } from "@/lib/auth/scope";
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
