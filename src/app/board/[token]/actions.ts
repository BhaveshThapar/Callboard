"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { violatedConstraint } from "@/db/errors";
import {
  boardAssignments,
  CHAIN_INDEX_NAMES,
  deductions,
  judgeAssignments,
  TEAM_STATUSES,
} from "@/db/schema";
import type { TeamStatus } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { setTeamStatus, setWaitlistRank } from "@/lib/roster/roster";
import {
  listBoardForBoard,
  NOT_COMPETING,
  resolveBoardActor,
  resolveTeamForBoard,
} from "@/lib/auth/scope";
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
 * `violatedConstraint` is what digs the name out of the cause chain, and why it must be dug out at
 * all is written there: drizzle's own message is the failed SQL, and a board member must never be
 * shown `Failed query: insert into "tab_runs" ...` at the moment placements go final.
 */
const isChainFork = (error: unknown): boolean => {
  const constraint = violatedConstraint(error);
  return constraint !== null && CHAIN_INDEXES.has(constraint);
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

    if (!(await resolveTeamForBoard(actor, teamId))) {
      return { status: "error", message: NOT_COMPETING };
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

    // The correction's inputs are the superseded run's frozen inputs plus exactly this deduction.
    // `lockResults` does not re-read the tables for an override, so the deduction has to be handed
    // to it -- writing the row above is what makes it attributable, not what makes it counted.
    const run = await lockResults(actor.compId, {
      lockedByPersonId: actor.personId,
      overrideReason,
      addDeductions: wantsDeduction ? [{ teamId, points, reason }] : [],
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

/**
 * Kills a board member's link. `board_assignments.revoked_at` has been read by `resolveBoardActor`
 * since ADR-0007 and written by nothing, so a leaked board link could lock, override and deduct
 * under a named person's attribution and could not be killed from the product — only from the
 * database. ADR-0007 said board links got revocation "for free" when it made them per person; that
 * was true of the read path and false of the write path.
 *
 * Two things differ from `revokeJudgeAction`, and both are the point.
 *
 * It stays available **after the lock**, where judge revocation does not. A judge whose link is
 * dead after the lock can do nothing anyway — scoring is closed. A board link is the opposite: it
 * can still override a locked result, so the moment a leaked one matters most is precisely the
 * moment the judge rule would have stopped you killing it.
 *
 * And it refuses to revoke the **last** live link. Nothing in this product mints one (ADR-0011), so
 * a board that revokes its way to zero cannot get back in — it would be locked out of its own comp,
 * mid-night, with no instrument to recover and a seed the only way back, which would destroy the
 * scores. The guard is a check-then-write like every other, and it can race; the cost of losing
 * that race is one revocation too many, which is why the refusal is here and not merely in the UI.
 */
export const revokeBoardAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const token = String(formData.get("token") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "");

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };
  if (!assignmentId) return { status: "error", message: "Pick a board member." };

  const live = (await listBoardForBoard(actor)).filter((member) => member.revokedAt === null);
  if (!live.some((member) => member.assignmentId === assignmentId)) {
    return { status: "error", message: "That board link is already revoked." };
  }
  if (live.length <= 1) {
    return {
      status: "error",
      message: "This is the last working board link. Revoking it would lock the board out for good.",
    };
  }

  const [row] = await db
    .update(boardAssignments)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(boardAssignments.id, assignmentId),
        eq(boardAssignments.compId, actor.compId),
        isNull(boardAssignments.revokedAt),
      ),
    )
    .returning({ id: boardAssignments.id, personId: boardAssignments.personId });

  if (!row) return { status: "error", message: "That board link is already revoked." };

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "board.revoke",
    entity: "board_assignment",
    entityId: row.id,
    after: { revokedPersonId: row.personId },
  });

  // Revoking your own link -- the thing you do the moment you realise it leaked -- must still tell
  // you it worked. Revalidating would re-render the page through `resolveBoardActor`, which now
  // resolves the dead token to nothing, and the board member would get a bare 404 instead of an
  // answer. So the page is left standing, stale, holding the one sentence it needs to show.
  if (row.personId === actor.personId) {
    return {
      status: "ok",
      message: "Your own board link no longer opens. Close this tab; reloading it will 404.",
    };
  }

  revalidatePath(`/board/${token}`);
  return { status: "ok", message: "That board link no longer opens." };
};

/**
 * Registration's one write from the board side (A2). The interesting half is not the status change
 * but what rides with it: dropping a team that held a slot promotes the top of the waitlist, and the
 * two land together or not at all (ADR-0012). A half-applied promotion is a comp that has lost a
 * team and not replaced it, or one with more accepted teams than slots — both states a human has to
 * find and repair by hand, which is the reconciliation problem this product is sold to end.
 */
export const setTeamStatusAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const token = String(formData.get("token") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const to = String(formData.get("status") ?? "");

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

  if (!TEAM_STATUSES.includes(to as TeamStatus)) {
    return { status: "error", message: "That is not a roster status." };
  }

  const result = await setTeamStatus(actor, teamId, to as TeamStatus);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`/board/${token}/roster`);
  return {
    status: "ok",
    message: result.promoted
      ? `Dropped. ${result.promoted.name} was promoted off the waitlist into the slot.`
      : `Team is now ${to}.`,
  };
};

/**
 * The other half of the waitlist (A2): a board could append to its queue but not rearrange it, so
 * arrival order was the only order it could ever have. A board that has decided a team should go
 * first now has an instrument to say so, instead of dropping and re-waitlisting teams to fake one.
 */
export const setWaitlistRankAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const token = String(formData.get("token") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const direction = String(formData.get("direction") ?? "");

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

  if (direction !== "up" && direction !== "down") {
    return { status: "error", message: "That is not a direction." };
  }

  const result = await setWaitlistRank(actor, teamId, direction);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`/board/${token}/roster`);
  return { status: "ok", message: "Waitlist reordered." };
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

  // The pre-lock twin of the check in `overrideAction`, and it was missing here. No forged request
  // is needed to reach it: a team is dropped, a board member's open tab still lists it in the
  // dropdown, and they apply a penalty to it. The row would be written and the board told it landed,
  // while `tabulate()` filtered it straight back out for naming a team not on the roster.
  if (!(await resolveTeamForBoard(actor, teamId))) {
    return { status: "error", message: NOT_COMPETING };
  }

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
