"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { deductions } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { resolveBoardActor } from "@/lib/auth/scope";
import { latestLockedRun, lockResults } from "@/lib/comp/tab";
import type { BoardActionState } from "./state";

export const lockAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const token = String(formData.get("token") ?? "");
  const overrideReason = String(formData.get("overrideReason") ?? "").trim();

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

  const existing = await latestLockedRun(actor.compId);
  if (existing && !overrideReason) {
    return {
      status: "error",
      message: "Results are already locked. Re-locking requires a written reason.",
    };
  }

  try {
    const run = await lockResults(actor.compId, {
      overrideReason: overrideReason || undefined,
    });

    await recordAudit({
      compId: actor.compId,
      actorKind: "board",
      action: existing ? "tab.override" : "tab.lock",
      entity: "tab_run",
      entityId: run.id,
      before: existing ? { tabRunId: existing.id } : null,
      after: { tabRunId: run.id, overrideReason: run.overrideReason },
    });

    revalidatePath(`/board/${token}`);
    return { status: "ok", message: existing ? "Results re-locked." : "Results locked." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Lock failed." };
  }
};

export const addDeductionAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const token = String(formData.get("token") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const points = Number(formData.get("points"));

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

  if (await latestLockedRun(actor.compId)) {
    return { status: "error", message: "Results are locked. Deductions can no longer be added." };
  }
  if (!teamId) return { status: "error", message: "Pick a team." };
  if (!Number.isInteger(points) || points <= 0) {
    return { status: "error", message: "Deduction must be a whole number above zero." };
  }
  if (!reason) return { status: "error", message: "A deduction needs a reason." };

  const [row] = await db
    .insert(deductions)
    .values({ compId: actor.compId, teamId, points, reason })
    .returning();

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    action: "deduction.add",
    entity: "team",
    entityId: teamId,
    after: { points, reason, deductionId: row?.id },
  });

  revalidatePath(`/board/${token}`);
  return { status: "ok", message: `Applied −${points} to the team.` };
};
