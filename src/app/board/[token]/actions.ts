"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { CHAIN_INDEX_NAMES, deductions, judgeAssignments } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { listTeamsForBoard, resolveBoardActor } from "@/lib/auth/scope";
import { latestLockedRun, lockResults, runCount } from "@/lib/comp/tab";
import type { BoardActionState } from "./state";

const CHAIN_INDEXES = new Set<string>(CHAIN_INDEX_NAMES);

/**
 * The database refusing to fork the run chain — a second root (`tab_runs_root_unique`) or a second
 * run superseding the same head (`tab_runs_supersedes_unique`).
 *
 * Both mean one thing to a board member: somebody else got there first. The `latestLockedRun`
 * checks below catch the ordinary case, but they structurally cannot catch this one — neon-http has
 * no transactions, so the check and the insert are two acts, and two people submitting at once can
 * land between them. Postgres is the only thing that can refuse it.
 *
 * The `constraint` lives on the *cause*, not on what is thrown: drizzle wraps the driver error, and
 * its own message is the failed SQL. Read that message and a board member is shown
 * `Failed query: insert into "tab_runs" ...` at the moment placements go final.
 */
const isChainFork = (error: unknown): boolean => {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ("constraint" in e && CHAIN_INDEXES.has(String(e.constraint))) return true;
  }
  return false;
};

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
    if (isChainFork(error)) {
      revalidatePath(`/board/${token}`);
      return {
        status: "error",
        message:
          "Another board member locked these results first. Correcting them requires a written reason.",
      };
    }
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

    // Same reason the judge's score path checks it: `teamId` comes off the form, and a deduction row
    // carries a bare team FK that the database would happily point at another comp's team.
    const scoreable = await listTeamsForBoard(actor);
    if (!scoreable.some((team) => team.id === teamId)) {
      return { status: "error", message: "That team is not competing in this comp." };
    }
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

    if (isChainFork(error)) {
      revalidatePath(`/board/${token}`);
      return {
        status: "error",
        message:
          "Another board member corrected these results first. Reload before correcting again.",
      };
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
