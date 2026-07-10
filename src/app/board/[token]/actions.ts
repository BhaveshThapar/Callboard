"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { deductions, judgeAssignments } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { resolveBoardActor } from "@/lib/auth/scope";
import { latestLockedRun, lockResults, runCount } from "@/lib/comp/tab";
import type { BoardActionState } from "./state";

export const lockAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const token = String(formData.get("token") ?? "");

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

  if (await latestLockedRun(actor.compId)) {
    return {
      status: "error",
      message: "Results are already locked. Correcting them requires a written reason.",
    };
  }

  try {
    const run = await lockResults(actor.compId, { lockedByPersonId: actor.personId });

    await recordAudit({
      compId: actor.compId,
      actorKind: "board",
      actorPersonId: actor.personId,
      action: "tab.lock",
      entity: "tab_run",
      entityId: run.id,
      after: { tabRunId: run.id },
    });

    revalidatePath(`/board/${token}`);
    return { status: "ok", message: "Results locked." };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Lock failed." };
  }
};

/**
 * The only way a locked result changes. Scores stay immutable, so a correction is expressed as a
 * deduction — the one append-only lever the board has — and the re-tabulation it forces. Nothing is
 * edited: the prior run keeps its frozen inputs and a new run supersedes it, naming the person and
 * the reason.
 *
 * The deduction lands before the lock so that `lockResults` picks it up. There is no transaction:
 * the neon-http driver has none. If the lock fails after the deduction is written, the prior run
 * still stands and the board can re-submit the correction with the deduction fields left blank.
 */
export const overrideAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const token = String(formData.get("token") ?? "");
  const overrideReason = String(formData.get("overrideReason") ?? "").trim();
  const teamId = String(formData.get("teamId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const rawPoints = String(formData.get("points") ?? "").trim();

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

  const existing = await latestLockedRun(actor.compId);
  if (!existing) return { status: "error", message: "Nothing is locked yet." };
  if (!overrideReason) return { status: "error", message: "A correction needs a written reason." };

  const points = Number(rawPoints);
  const wantsDeduction = teamId !== "" || reason !== "" || rawPoints !== "";
  if (wantsDeduction) {
    if (!teamId) return { status: "error", message: "Pick a team, or clear the deduction fields." };
    if (!Number.isInteger(points) || points <= 0) {
      return { status: "error", message: "Deduction must be a whole number above zero." };
    }
    if (!reason) return { status: "error", message: "A deduction needs a reason." };
  }

  let deductionId: string | undefined;
  try {
    if (wantsDeduction) {
      const [row] = await db
        .insert(deductions)
        .values({ compId: actor.compId, teamId, points, reason, createdByPersonId: actor.personId })
        .returning();
      deductionId = row?.id;
    }

    const run = await lockResults(actor.compId, {
      lockedByPersonId: actor.personId,
      overrideReason,
    });
    const runNumber = await runCount(actor.compId);

    if (deductionId) {
      await recordAudit({
        compId: actor.compId,
        actorKind: "board",
        actorPersonId: actor.personId,
        action: "deduction.add",
        entity: "team",
        entityId: teamId,
        after: { points, reason, deductionId, correctsRunId: existing.id },
      });
    }

    await recordAudit({
      compId: actor.compId,
      actorKind: "board",
      actorPersonId: actor.personId,
      action: "tab.override",
      entity: "tab_run",
      entityId: run.id,
      before: { tabRunId: existing.id },
      after: { tabRunId: run.id, overrideReason },
    });

    revalidatePath(`/board/${token}`);
    return { status: "ok", message: `Run ${runNumber} supersedes run ${runNumber - 1}.` };
  } catch (error) {
    // The deduction is already written and there is no transaction to roll back. Left alone it
    // would be folded silently into whatever locks next -- a penalty the board was told had
    // failed. So withdraw it, unless a concurrent correction has already locked and frozen it into
    // a snapshot, where it must stand rather than be erased from a result that counted it.
    if (deductionId) {
      const current = await latestLockedRun(actor.compId);
      if (current && current.id !== existing.id) {
        revalidatePath(`/board/${token}`);
        return {
          status: "error",
          message:
            "Another board member locked a correction first, and it counted your deduction. Reload before correcting again.",
        };
      }
      await db.delete(deductions).where(eq(deductions.id, deductionId));
    }

    return {
      status: "error",
      message: error instanceof Error ? error.message : "Correction failed.",
    };
  }
};

/**
 * Kills a judge's link. Their submitted scores stand and still count -- the record is append-only,
 * and a revoked link is not a retracted opinion. Scoped to the actor's comp so a board cannot reach
 * another comp's judge, and idempotent: revoking twice is not an error worth surfacing.
 */
export const revokeJudgeAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const token = String(formData.get("token") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "");

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

  if (await latestLockedRun(actor.compId)) {
    return { status: "error", message: "Results are locked. Judge links can no longer change." };
  }
  if (!assignmentId) return { status: "error", message: "Pick a judge." };

  const [row] = await db
    .update(judgeAssignments)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(judgeAssignments.id, assignmentId),
        eq(judgeAssignments.compId, actor.compId),
        isNull(judgeAssignments.revokedAt),
      ),
    )
    .returning({ id: judgeAssignments.id, personId: judgeAssignments.personId });

  if (!row) return { status: "error", message: "That judge link is already revoked." };

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "judge.revoke",
    entity: "judge_assignment",
    entityId: row.id,
    after: { revokedPersonId: row.personId },
  });

  revalidatePath(`/board/${token}`);
  return { status: "ok", message: "That scoring link no longer opens." };
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
    .values({ compId: actor.compId, teamId, points, reason, createdByPersonId: actor.personId })
    .returning();

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "deduction.add",
    entity: "team",
    entityId: teamId,
    after: { points, reason, deductionId: row?.id },
  });

  revalidatePath(`/board/${token}`);
  return { status: "ok", message: `Applied −${points} to the team.` };
};
