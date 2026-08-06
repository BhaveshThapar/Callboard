"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { violatedConstraint } from "@/db/errors";
import {
  boardAssignments,
  CHAIN_INDEX_NAMES,
  COMP_STATUSES,
  deductions,
  judgeAssignments,
  PAYMENT_RAILS,
  TEAM_STATUSES,
} from "@/db/schema";
import type { CompStatus, PaymentRail, TeamStatus } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { planAnnouncement } from "@/lib/comms/announce";
import { planDuesReminders } from "@/lib/comms/dues";
import { planFeedbackDelivery } from "@/lib/comms/feedback";
import { enqueue } from "@/lib/comms/outbox";
import { planDepositReturned, planPaymentReceipt } from "@/lib/comms/receipts";
import { captainsByTeam } from "@/lib/comms/recipients";
import { sendingConfigured } from "@/lib/comms/transport";
import { feeScheduleFor, today } from "@/lib/money/charges";
import { whoOwes } from "@/lib/money/who-owes";
import { invite, listInvitationsForBoard, orgOfComp, revokeAccess } from "@/lib/auth/accounts";
import type { InvitableRole } from "@/db/schema";
import { INVITABLE_ROLES } from "@/db/schema";
import type { DepositState } from "@/lib/money/deposit";
import { DEPOSIT_STATES } from "@/lib/money/deposit";
import { advanceDeposit, listDepositsForBoard } from "@/lib/money/deposits";
import { formatCents, parseDollars } from "@/lib/money/format";
import {
  allocatePayment,
  recordPayment,
  releaseAllocation,
  setPaymentReconciled,
} from "@/lib/money/ledger";
import {
  regenerateCharges,
  setTeamBilling,
  setTeamStatus,
  setWaitlistRank,
} from "@/lib/roster/roster";
import {
  listBoardForBoard,
  listJudgeLabelsForBoard,
  listRosterForBoard,
  NOT_COMPETING,
  resolveRosterTeamForBoard,
  resolveTeamForBoard,
} from "@/lib/auth/scope";
import { resolveBoardAccess } from "@/lib/auth/access";
import { notesForBoard } from "@/lib/comp/feedback";
import { setCompStatus } from "@/lib/comp/status";
import { latestLockedRun, lockResults, runCount } from "@/lib/comp/tab";
import { noteKey } from "@/lib/export/feedback";
import type { BoardActionState } from "./state";

const CHAIN_INDEXES = new Set<string>(CHAIN_INDEX_NAMES);

/**
 * What every write says when the actor cannot be resolved, in one place because it is one sentence.
 *
 * It has to cover both ways in without knowing which the reader used ([ADR-0022]): a session that
 * expired, a membership a board revoked, a board link that was killed, or a link for one comp being
 * used against another. Naming which would be a small oracle — *that comp exists and your link is
 * valid, just not here* is more than a stranger should learn from a failed POST.
 *
 * [ADR-0022]: ../../../../../docs/decisions/0022-a-link-is-exchanged-for-a-cookie.md
 */
const NO_ACCESS = "You do not have access to this comp. Sign in again, or reopen your board link.";

/**
 * Two fields on every board form, and they are deliberately not the same field.
 *
 * `compId` is the **authorization subject** — it is what `resolveBoardAccess` proves the holder may
 * open, and a forged one simply resolves to nothing. `basePath` is display only: it exists so
 * `revalidatePath` can bust the right cache entry, and the worst a forged one can do is refresh a
 * page the sender could already refresh themselves.
 *
 * Keeping them apart is the point. One untrusted string that both authorized *and* addressed would
 * be a single value doing two jobs, and the day somebody trusted it for the second reason it would
 * already be trusted for the first.
 */
export type BoardFormScope = { compId: string; basePath: string };

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
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

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

    revalidatePath(basePath);
    return { status: "ok", message: "Results locked." };
  } catch (error) {
    if (isChainFork(error)) {
      revalidatePath(basePath);
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
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const overrideReason = String(formData.get("overrideReason") ?? "").trim();
  const teamId = String(formData.get("teamId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const rawPoints = String(formData.get("points") ?? "").trim();

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

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

    revalidatePath(basePath);
    return { status: "ok", message: `Run ${runNumber} supersedes run ${runNumber - 1}.` };
  } catch (error) {
    // The deduction is already written and there is no transaction to roll back. Left alone it
    // would be folded silently into whatever locks next -- a penalty the board was told had
    // failed. So withdraw it, unless a concurrent correction has already locked and frozen it into
    // a snapshot, where it must stand rather than be erased from a result that counted it.
    if (deductionId) {
      const current = await latestLockedRun(actor.compId);
      if (current && current.id !== existing.id) {
        revalidatePath(basePath);
        return {
          status: "error",
          message:
            "Another board member locked a correction first, and it counted your deduction. Reload before correcting again.",
        };
      }
      await db.delete(deductions).where(eq(deductions.id, deductionId));
    }

    if (isChainFork(error)) {
      revalidatePath(basePath);
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
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

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

  revalidatePath(basePath);
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
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const assignmentId = String(formData.get("assignmentId") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };
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
  // you it worked. Revalidating would re-render the page through a credential that no longer
  // resolves, and the board member would get a bare 404 instead of an answer. So the page is left
  // standing, stale, holding the one sentence it needs to show.
  //
  // The sentence has to be true both ways since ADR-0022: if this browser got here by link, the
  // link is dead and a reload 404s; if it got here by signing in, the membership is untouched and a
  // reload is fine. Saying which would mean branching on `boardAssignmentId`, and the honest
  // sentence covers both without the product having to guess which tab you are looking at.
  if (row.personId === actor.personId) {
    return {
      status: "ok",
      message:
        "Your own board link no longer opens. If you also have an account here, signing in still works.",
    };
  }

  revalidatePath(basePath);
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
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const to = String(formData.get("status") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

  if (!TEAM_STATUSES.includes(to as TeamStatus)) {
    return { status: "error", message: "That is not a roster status." };
  }

  const result = await setTeamStatus(actor, teamId, to as TeamStatus);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`${basePath}/roster`);
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
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const direction = String(formData.get("direction") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

  if (direction !== "up" && direction !== "down") {
    return { status: "error", message: "That is not a direction." };
  }

  const result = await setWaitlistRank(actor, teamId, direction);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`${basePath}/roster`);
  return { status: "ok", message: "Waitlist reordered." };
};

/**
 * Opening and closing the comp's own registration window (A1/A2).
 *
 * `comps.status` gates the public form and had exactly one writer in the repo — the seed script. So
 * a board could open registration from a config and then had no way to close it: reseeding is the
 * only other path, and a reseed replaces the comp and reissues every token (ADR-0013), killing the
 * links already in people's phones. Closing a form meant destroying the comp.
 */
export const setCompStatusAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const to = String(formData.get("status") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

  if (!COMP_STATUSES.includes(to as CompStatus)) {
    return { status: "error", message: "That is not a comp status." };
  }

  const result = await setCompStatus(actor, to as CompStatus);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(basePath);
  revalidatePath(`${basePath}/roster`);
  return {
    status: "ok",
    message:
      result.status === "open"
        ? "Registration is open. The public form accepts applications."
        : `This comp is now ${result.status}. The registration form is closed.`,
  };
};

/**
 * A blank field is *not yet known* and a `0` is a stated zero. `BillableTeam` draws that line and
 * the whole gap machinery rests on it: null withholds a charge and says why, zero charges nothing
 * and means it. So an empty input has to survive the round trip as null rather than becoming `0`,
 * which `Number("")` would do silently.
 */
const parseCount = (raw: string): { ok: true; value: number | null } | { ok: false } => {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return { ok: false };
  return { ok: true, value };
};

/**
 * The dancer count and the room count a team is billed on (A3/A6).
 *
 * `teams.rooms` shipped with no writer outside the seed, so the hotel line was unbillable for every
 * team that ever registered through the product — the engine withheld it correctly, said "room count
 * unknown", and the board had no way to answer. This is the answer.
 */
export const setTeamBillingAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const teamId = String(formData.get("teamId") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };
  if (!teamId) return { status: "error", message: "Pick a team." };

  const rosterSize = parseCount(String(formData.get("rosterSize") ?? ""));
  if (!rosterSize.ok) {
    return { status: "error", message: "Dancers must be a whole number, or blank if not known yet." };
  }

  const rooms = parseCount(String(formData.get("rooms") ?? ""));
  if (!rooms.ok) {
    return { status: "error", message: "Rooms must be a whole number, or blank if not known yet." };
  }

  const result = await setTeamBilling(actor, teamId, {
    rosterSize: rosterSize.value,
    rooms: rooms.value,
  });
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`${basePath}/roster`);
  revalidatePath(`${basePath}/money`);
  return { status: "ok", message: "Updated, and the charges with it." };
};

/**
 * Re-runs the fee schedule over the whole billable roster (A6).
 *
 * Until this existed, `syncCharges` ran only from `setTeamStatus` — so nothing regenerated charges
 * once a team's status had settled, and a late fee whose date passed in February was never billed to
 * anybody accepted in December. It is safe to click twice: `planCharges` keys on `(teamId, kind)`,
 * so an unchanged roster plans nothing.
 */
export const regenerateChargesAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

  const result = await regenerateCharges(actor);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`${basePath}/money`);
  revalidatePath(`${basePath}/roster`);

  // Naming both numbers, including two zeros. "Nothing changed" is the answer a board most needs to
  // be able to trust, and a bare "Done." makes a no-op and a re-bill read identically.
  return {
    status: "ok",
    message: `Regenerated: ${result.inserted} charge${result.inserted === 1 ? "" : "s"} added, ${result.voided} voided.`,
  };
};

/**
 * A8, reachable at last. The ledger shipped with `recordPayment` and nothing calling it, so a board
 * could generate what a team owes (`setTeamStatus` → `syncCharges`) and had no instrument to say a
 * cent of it had arrived — every accepted team a permanent debtor, and the CSV a treasurer opens
 * beside a bank statement reporting the whole season unpaid.
 *
 * Nothing here validates money. The dollars-to-cents edge is `parseDollars` and every refusal past
 * it is `recordPayment`'s, whose sentences already come from `violatedConstraint` rather than from a
 * driver message. This parses a form and delegates.
 */
export const recordPaymentAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const rail = String(formData.get("rail") ?? "");
  const externalRef = String(formData.get("externalRef") ?? "").trim();

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

  if (!teamId) return { status: "error", message: "Pick a team." };
  if (!PAYMENT_RAILS.includes(rail as PaymentRail)) {
    return { status: "error", message: "That is not a payment rail." };
  }

  const grossCents = parseDollars(String(formData.get("gross") ?? ""));
  if (grossCents === null) {
    return { status: "error", message: "Enter the amount as dollars and cents, like 2160.00." };
  }

  const feeInput = String(formData.get("fee") ?? "").trim();
  const feeCents = feeInput === "" ? 0 : parseDollars(feeInput);
  if (feeCents === null) {
    return { status: "error", message: "Enter the processing fee as dollars and cents, or leave it blank." };
  }

  // Every `allocation-<chargeId>` field the form rendered. A blank one is not an allocation, which
  // is what lets a treasurer record a lump against one obligation and leave the rest for later.
  const allocations: { chargeId: string; amountCents: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("allocation-")) continue;
    const raw = String(value).trim();
    if (raw === "") continue;

    const amountCents = parseDollars(raw);
    if (amountCents === null) {
      return { status: "error", message: "Enter each allocation as dollars and cents, or leave it blank." };
    }
    allocations.push({ chargeId: key.slice("allocation-".length), amountCents });
  }

  const result = await recordPayment(actor, {
    teamId,
    rail: rail as PaymentRail,
    grossCents,
    feeCents,
    externalRef: externalRef === "" ? undefined : externalRef,
    allocations,
  });
  if (!result.ok) return { status: "error", message: result.message };

  /**
   * A7's receipt, and it is queued **after** the ledger's transaction rather than inside it.
   *
   * `recordPayment` is one of the four sanctioned `withTransaction` callers because a payment row,
   * its allocations and the counter that constrains them are one act. A receipt is not part of that
   * act: it is a consequence of it. Putting the enqueue inside would mean a comms failure rolls back
   * money that genuinely arrived, which is the reconciliation gap this product is sold against,
   * caused by the feature that announces it.
   *
   * So the money is already safe by the time this runs, and a failure here costs a notification.
   * The receipt is opt-out rather than automatic — a treasurer backfilling last season's payments on
   * a Sunday must not mail thirty captains, and the checkbox is where they say so.
   */
  let receipt: "queued" | "already" | "no-contact" | "off" = "off";
  if (String(formData.get("receipt") ?? "") !== "") {
    const [roster, captains] = await Promise.all([
      listRosterForBoard(actor),
      captainsByTeam(actor.compId),
    ]);
    const team = roster.find((row) => row.id === teamId);
    const plan = team
      ? planPaymentReceipt(
          team,
          captains,
          {
            id: result.paymentId,
            grossCents,
            feeCents,
            rail: rail as PaymentRail,
          },
          { compName: actor.compName },
        )
      : null;

    if (!plan) {
      receipt = "no-contact";
    } else {
      const queued = await enqueue({
        compId: actor.compId,
        personId: plan.personId,
        template: "payment.receipt",
        payload: plan.payload,
        dedupeKey: plan.dedupeKey,
        createdByPersonId: actor.personId,
      });
      receipt = queued.ok ? "queued" : queued.reason === "duplicate" ? "already" : "no-contact";
    }
  }

  const RECEIPT_SAID: Record<typeof receipt, string> = {
    queued: " A receipt is on its way to the captain.",
    already: " A receipt for this payment already went out.",
    // Named rather than swallowed: a board that ticked the box and got nothing sent has to be told,
    // for the same reason A10 names the teams it could not chase.
    "no-contact": " No receipt — this team has no captain on file.",
    off: "",
  };

  revalidatePath(`${basePath}/money`);
  revalidatePath(`${basePath}/roster`);
  return {
    status: "ok",
    message:
      (result.creditCents > 0
        ? `Recorded. ${formatCents(result.creditCents)} of it is not attached to anything yet.`
        : "Recorded.") + RECEIPT_SAID[receipt],
  };
};

/**
 * Attaching a lump to the obligations it turned out to be for, after the fact.
 *
 * The reason this is a separate action rather than an edit to the one above: a payment's purpose is
 * often learned later. NCSU's $2,160 arrived labelled "hotel, security deposit & reg fees" and had
 * to be unbundled by hand; a team that pays a deposit to hold a slot has no charges to attach it to
 * until it is accepted. Neither is reachable from the entry form, however good the form is.
 */
export const allocatePaymentAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };
  if (!paymentId) return { status: "error", message: "Pick a payment." };

  const allocations: { chargeId: string; amountCents: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("apply-")) continue;
    const raw = String(value).trim();
    if (raw === "") continue;

    const amountCents = parseDollars(raw);
    if (amountCents === null) {
      return { status: "error", message: "Enter each amount as dollars and cents, or leave it blank." };
    }
    allocations.push({ chargeId: key.slice("apply-".length), amountCents });
  }

  const result = await allocatePayment(actor, paymentId, allocations);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`${basePath}/money`);
  revalidatePath(`${basePath}/roster`);
  return {
    status: "ok",
    message:
      result.creditCents > 0
        ? `Applied. ${formatCents(result.creditCents)} is still unattached.`
        : "Applied. All of it is now attached.",
  };
};

/**
 * Taking a wrong label back off money that did arrive.
 *
 * The counterpart to `allocatePaymentAction`, and the half that was missing: `releaseAllocation` was
 * written, transactional and audited, and **had no caller anywhere in the repo**, so attribution was
 * one-way. A treasurer who put $560 on the deposit instead of the hotel could not undo it —
 * `payment_allocations_live_unique` refuses the corrected attempt, and `recordPayment`'s own ceiling
 * message told them to *"adjust the existing allocation instead"*, naming an instrument that did not
 * exist. The only escape was a roster move that voided the whole charge.
 *
 * **No balance moves**, which is worth saying on the screen and is why the message says *unattached*
 * rather than *refunded*: `paid` is the sum of gross, so this changes what the money is for and not
 * whether it arrived.
 */
export const releaseAllocationAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const allocationId = String(formData.get("allocationId") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };
  if (!allocationId) return { status: "error", message: "Pick an allocation to release." };

  const result = await releaseAllocation(actor, allocationId);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`${basePath}/money`);
  revalidatePath(`${basePath}/roster`);
  return {
    status: "ok",
    message: `Released. ${formatCents(result.creditCents)} is unattached again — the balance has not moved.`,
  };
};

/**
 * Ticking a payment off against the bank statement.
 *
 * `payments.reconciled_at` shipped in migration `0009` and nothing wrote it, which left the metric
 * PRD §13 names — reconciliation error vs. bank, target $0 — with no instrument behind it. A
 * treasurer could match rows by eye and had nowhere to record having done it.
 */
export const reconcilePaymentAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const reconciled = String(formData.get("reconciled") ?? "") === "true";

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };
  if (!paymentId) return { status: "error", message: "Pick a payment." };

  const result = await setPaymentReconciled(actor, paymentId, reconciled);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`${basePath}/money`);
  return {
    status: "ok",
    message: reconciled ? "Matched against the bank." : "Mark removed.",
  };
};

/**
 * A7 gets a hand on it. `advanceDeposit` and `listDepositsForBoard` had no importer anywhere, so
 * the state machine, its guards and its terminal index were exercised only by a test fixture that
 * deliberately bypasses the product path — `e2e/support/deposit.ts` says so in its own header.
 *
 * Returning a deposit is the most consequential money act a board performs, and until now it
 * happened in Venmo with no record of who decided or why.
 *
 * The form carries a `teamId` rather than a `chargeId` since `0011`: a deposit's fate belongs to the
 * team, not to whichever charge row happened to be carrying it when the board clicked (ADR-0015).
 */
export const advanceDepositAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const to = String(formData.get("state") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

  if (!DEPOSIT_STATES.includes(to as DepositState)) {
    return { status: "error", message: "That is not a deposit state." };
  }

  // Keeping a team's money is a decision that has to be explainable, which is `overrideReason`'s
  // argument. Returning it is the expected ending and needs no defence.
  if (to === "forfeited" && !reason) {
    return { status: "error", message: "Forfeiting a deposit needs a written reason." };
  }

  const result = await advanceDeposit(actor, teamId, to as DepositState, reason || null);
  if (!result.ok) return { status: "error", message: result.message };

  /**
   * A7's other receipt, and only for `refunded`.
   *
   * There is deliberately no `forfeited` notice. A forfeit moves no money and is a board keeping
   * something a team believed was coming back; delivering that by form letter is the wrong
   * instrument, and the reason the board had to type is one they should say themselves.
   *
   * Outside the deposit's transaction for the receipt's reason: the money and its terminal event
   * land together or not at all, and a comms failure must not undo a refund that already happened.
   */
  let told = false;
  if (result.state === "refunded") {
    const [deposits, roster, captains] = await Promise.all([
      listDepositsForBoard(actor),
      listRosterForBoard(actor),
      captainsByTeam(actor.compId),
    ]);
    const deposit = deposits.find((row) => row.teamId === teamId);
    const team = roster.find((row) => row.id === teamId);

    const plan =
      deposit && team
        ? planDepositReturned(team, captains, deposit, {
            compName: actor.compName,
            boardName: actor.personName,
          })
        : null;

    if (plan) {
      const queued = await enqueue({
        compId: actor.compId,
        personId: plan.personId,
        template: "deposit.returned",
        payload: plan.payload,
        dedupeKey: plan.dedupeKey,
        createdByPersonId: actor.personId,
      });
      told = queued.ok;
    }
  }

  revalidatePath(`${basePath}/money`);
  revalidatePath(`${basePath}/roster`);
  return {
    status: "ok",
    message:
      result.state === "refunded"
        ? `Deposit returned. It is no longer owed and no longer counted as paid.${
            told ? " The captain has been told." : ""
          }`
        : `Deposit is now ${result.state.replace("_", " ")}.`,
  };
};

export const addDeductionAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const points = Number(formData.get("points"));

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

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

  revalidatePath(basePath);
  return { status: "ok", message: `Applied −${points} to the team.` };
};

/**
 * The minting path, reachable at last ([ADR-0016]).
 *
 * ADR-0011 refused to build this and named the reason: *"issuing a credential to a person for a comp
 * is board management, and that is the thin end of Module A."* It still is; the difference is that
 * Module A is now built and the features that need to reach a specific human are what is left.
 *
 * What arrives here is an email and a role, never a `personId`: the board is naming somebody who may
 * not exist yet, and `invite` finds-or-creates the person the way `findOrCreatePeople` already does.
 * A `teamId` **is** a claim and resolves through `listRosterForBoard`, because inviting a captain
 * for another comp's team is exactly the shape `resolveRosterTeamForBoard` exists to refuse.
 *
 * [ADR-0016]: ../../../../docs/decisions/0016-accounts-for-people-who-stay-links-for-people-who-visit.md
 */
export const inviteAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const teamId = String(formData.get("teamId") ?? "").trim();

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

  // `INVITABLE_ROLES`, not `ACCOUNT_ROLES`: a `liaison` membership is representable and a liaison
  // invitation is not, because nothing in the product can be opened by one. The form no longer offers
  // it, and this is what makes that a rule rather than markup — `validateAnswers`' reason.
  if (!INVITABLE_ROLES.includes(role as InvitableRole)) {
    return { status: "error", message: "Pick what they are being invited as." };
  }
  if (role === "captain" && !teamId) {
    return { status: "error", message: "A captain is invited for a team. Pick one." };
  }
  // The teamId is a claim, resolved against the read that produced the form it arrived on.
  if (teamId && !(await resolveRosterTeamForBoard(actor, teamId))) {
    return { status: "error", message: "That team is not in this comp." };
  }

  const orgId = await orgOfComp(actor.compId);
  if (!orgId) return { status: "error", message: "This comp is no longer here." };

  const result = await invite(
    { compId: actor.compId, personId: actor.personId, orgId },
    { email, name, role: role as InvitableRole, teamId: role === "captain" ? teamId : null },
  );
  if (!result.ok) return { status: "error", message: result.message };

  const url = `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/invite/${result.value.token}`;

  /**
   * The invitation now goes out by itself, and **the link is still shown anyway**.
   *
   * That is not belt-and-braces, it is the only safe order. Only the sha256 of the token is stored,
   * so nothing in the product can recover this link once the screen is gone — and sending is opt-in
   * on two environment variables. A board on a deployment without them, told "emailed", would close
   * the tab having destroyed the credential. So the link is shown, and the sentence beside it says
   * whether an email is actually coming.
   *
   * **The consequence worth naming: the raw token lives in `messages.payload` until it is sent**
   * ([ADR-0021](../../../../docs/decisions/0021-the-outbox-holds-a-secret-only-until-it-sends.md)).
   * ADR-0003's rule is that only the hash is stored, and emailing a link cannot honour that — the
   * outbox has to hold the thing it is going to send. So the window is closed at the other end
   * instead: `sweep` strips the field when the message reaches `sent`, which turns *every unspent
   * invitation in the table* into *whatever was queued in the last cron interval*. What bounds the
   * remainder is that an invitation names the person it is for before it is accepted, so a stolen
   * one grants exactly that person's role at that comp and cannot make the holder somebody else; it
   * is single-use and expires in two weeks.
   */
  const queued = await enqueue({
    compId: actor.compId,
    personId: result.value.personId,
    template: "invitation.created",
    payload: {
      personName: name,
      compName: actor.compName,
      role,
      invitedBy: actor.personName,
      url,
    },
    dedupeKey: `invite:${result.value.invitationId}`,
    createdByPersonId: actor.personId,
  });

  revalidatePath(`${basePath}/people`);
  return {
    status: "ok",
    message: `Invitation for ${email}: ${url} — ${
      queued.ok && sendingConfigured()
        ? "also emailed to them."
        : "sending is not configured, so send this link yourself."
    }`,
  };
};

/**
 * Taking somebody back off a comp — the other half of the minting path.
 *
 * `judge_assignments` and `board_assignments` have had revocation since ADR-0011; `memberships` did
 * not, so P1 shipped a way to add a person and no way to remove one. One button covers both states a
 * row can be in, because a board asking "take this person off" means the same thing whether they
 * have signed in yet or not: an accepted row loses its membership, an unspent one loses its envelope,
 * and a row that is both loses both.
 *
 * No last-one guard, unlike `revokeBoardAction`. That guard exists because nothing mints a board
 * *link* and a board could revoke its way out of its own comp; a membership opens no board screen
 * today, so revoking every one of them locks nobody out of anything.
 */
export const revokeAccessAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const personId = String(formData.get("personId") ?? "");
  const role = String(formData.get("role") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

  // `(personId, role)` is a claim, resolved against the read that produced the form it arrived on.
  // `listInvitationsForBoard` is comp-scoped by its own `where`, so another comp's person is refused
  // by the same `find` that refuses somebody nobody invited — the window rule, one level down, as a
  // `chargeId` resolves through the roster's own `charges` array.
  const invited = await listInvitationsForBoard(actor);
  const target = invited.find((row) => row.personId === personId && row.role === role);
  if (!target) return { status: "error", message: "Nobody was invited to this comp like that." };

  const result = await revokeAccess(actor, { personId, role: target.role });
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`${basePath}/people`);
  return {
    status: "ok",
    message: result.value.removedMembership
      ? `${target.name} can no longer open this comp.`
      : `The invitation for ${target.name} no longer opens.`,
  };
};

/**
 * A10 — the button that makes the outbox reachable.
 *
 * The engine shipped complete and with **no product caller**: `sweep` was wired to cron, but nothing
 * anywhere called `enqueue`, so in production the queue could only ever be empty. That is the defect
 * this repo has now recorded five times — `recordPayment`, `advanceDeposit`, `listDepositsForBoard`
 * and `releaseAllocation` each shipped audited and transactional with nobody calling them — and it
 * is why A10 lands beside the engine rather than a phase later.
 *
 * No new window. The debtor list is `whoOwes` over `listRosterForBoard`, which is the same read the
 * screen the button sits on was rendered from, so a `teamId` arriving here resolves against the plan
 * that read produced: a team in another comp, a settled team and a team that was never billed are
 * all refused by the same `find`, without a second definition of "which teams may be chased".
 *
 * Sending twice is not an error. `messages_comp_dedupe_unique` refuses the second insert and
 * `enqueue` reports `duplicate`, so a board that clicks again is told what actually happened —
 * nothing sent twice — rather than shown a failure over a system working correctly.
 */
export const sendDuesRemindersAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const teamId = String(formData.get("teamId") ?? "").trim();

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

  const [roster, schedule, captains] = await Promise.all([
    listRosterForBoard(actor),
    feeScheduleFor(actor.compId),
    /**
     * The captains who accepted an invitation, which is the only contact a **seeded** roster has.
     *
     * `teams.contact_person_id` is written by the registration form, and setup is founder-run by
     * design — so without this every founding partner's A10 button reports "nobody could be
     * reminded" and the feature is decorative for exactly the boards it was built for.
     *
     * Shared with the receipt path rather than queried twice: two copies of "who do we write to
     * about this team" is how a board gets chased at one address and receipted at another.
     */
    captainsByTeam(actor.compId),
  ]);

  const asOf = today();
  const plan = planDuesReminders(whoOwes(roster, schedule, asOf), roster, {
    compName: actor.compName,
    boardName: actor.personName,
    // Precedence lives in `contactPersonFor`, which this planner applies: a registered contact wins
    // and a captain's membership is the fallback, never the override.
    contactFor: captains,
    // The billing period the dedupe key is scoped to, stated here rather than inside the pure
    // planner: one reminder per team per calendar month is a policy, and it belongs at the call
    // site where a board's own answer can replace it.
    period: asOf.slice(0, 7),
  });

  const targets = teamId ? plan.send.filter((row) => row.teamId === teamId) : plan.send;

  if (teamId && targets.length === 0) {
    return { status: "error", message: "That team is not one this comp can chase right now." };
  }
  if (targets.length === 0) {
    const nobody =
      plan.skipped.length > 0
        ? `Nobody could be reminded: ${plan.skipped.length} team(s) owe money with no captain on file.`
        : "Nobody owes anything right now.";
    return { status: "error", message: nobody };
  }

  let queued = 0;
  let already = 0;
  let failed = 0;

  for (const target of targets) {
    const result = await enqueue({
      compId: actor.compId,
      personId: target.personId,
      template: "dues.reminder",
      payload: target.payload,
      dedupeKey: target.dedupeKey,
      createdByPersonId: actor.personId,
    });
    if (result.ok) queued += 1;
    else if (result.reason === "duplicate") already += 1;
    else failed += 1;
  }

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "dues.remind",
    entity: "comp",
    entityId: actor.compId,
    after: { queued, already, failed, skipped: plan.skipped.length, teamId: teamId || null },
  });

  revalidatePath(`${basePath}/money`);

  const parts = [
    queued > 0 ? `${queued} reminder${queued === 1 ? "" : "s"} queued` : null,
    already > 0 ? `${already} already sent this month` : null,
    failed > 0 ? `${failed} could not be queued` : null,
    // Only when chasing everybody: a board that asked about one team is not being told about others.
    !teamId && plan.skipped.length > 0
      ? `${plan.skipped.length} owe money with no captain on file (${plan.skipped
          .map((row) => row.teamName)
          .join(", ")})`
      : null,
  ].filter((part) => part !== null);

  return {
    status: failed > 0 ? "error" : "ok",
    message: `${parts.join(" · ")}. Sending happens in the background; watch the outbox.`,
  };
};


/**
 * The board saying something to every team that is coming.
 *
 * The first **broadcast** send in the product, which is what makes `people.unsubscribed_at` load
 * bearing rather than decorative: `sweep` bounces a broadcast to somebody who opted out and delivers
 * a transactional one, so this is the path that respects it. A board is told how many that was —
 * silently reaching fewer people than the screen implies is the failure this whole feature would
 * otherwise introduce.
 *
 * No window is added. The audience is `listRosterForBoard` filtered by `ANNOUNCEABLE_STATUSES`, and
 * no id arrives on the form at all — the subject is the actor's own comp, which is `setCompStatus`'
 * and `regenerateCharges`' shape. There is nothing here to check because there is no claim.
 */
export const sendAnnouncementAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

  if (!subject) return { status: "error", message: "An announcement needs a subject line." };
  if (!body) return { status: "error", message: "An announcement needs something to say." };

  const [roster, captains] = await Promise.all([
    listRosterForBoard(actor),
    captainsByTeam(actor.compId),
  ]);

  const plan = planAnnouncement(roster, captains, {
    compName: actor.compName,
    boardName: actor.personName,
    subject,
    body,
    // The one place the opt-out address is decided. It lands on the payload, so the visible line in
    // the body and the `List-Unsubscribe` header the transport sets are the same string.
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "",
  });

  if (plan.send.length === 0) {
    return {
      status: "error",
      message:
        plan.skipped.length > 0
          ? `Nobody could be reached: ${plan.skipped.length} team(s) have no captain on file.`
          : "No team is accepted or competing yet, so there is nobody to announce to.",
    };
  }

  let queued = 0;
  let already = 0;
  for (const target of plan.send) {
    const result = await enqueue({
      compId: actor.compId,
      personId: target.personId,
      template: "announcement.sent",
      payload: target.payload,
      dedupeKey: target.dedupeKey,
      createdByPersonId: actor.personId,
    });
    if (result.ok) queued += 1;
    else if (result.reason === "duplicate") already += 1;
  }

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "announcement.send",
    entity: "comp",
    entityId: actor.compId,
    // The text, because an announcement is a thing a board said and the record should hold what.
    after: { subject, queued, already, skipped: plan.skipped.length },
  });

  revalidatePath(`${basePath}/roster`);

  const parts = [
    queued > 0 ? `Sent to ${queued} team${queued === 1 ? "" : "s"}` : null,
    already > 0 ? `${already} already had this exact message` : null,
    plan.skipped.length > 0
      ? `${plan.skipped.length} have no captain on file (${plan.skipped
          .map((row) => row.teamName)
          .join(", ")})`
      : null,
  ].filter((part) => part !== null);

  return {
    status: "ok",
    message: `${parts.join(" · ")}. Anyone who unsubscribed will not receive it.`,
  };
};

/**
 * ADJ·2 — delivering the judges' notes, which the map has carried as the unbuilt half since B8.
 *
 * Refused before the lock, and that is not a convenience: the placement and the deduction come from
 * the frozen `tab_runs` snapshot, so what a team receives is what the placements were announced
 * from. Notes are read live because they are deliberately not in the snapshot and are refused after
 * the lock, so both halves are fixed at the same moment.
 *
 * Keyed on the team **and the run**, so a correction is deliverable. An override supersedes the run,
 * which mints new keys; pressing send twice against the same run reaches nobody twice.
 */
export const sendFeedbackAction = async (
  _previous: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> => {
  const compId = String(formData.get("compId") ?? "");
  const basePath = String(formData.get("basePath") ?? "");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return { status: "error", message: NO_ACCESS };

  const locked = await latestLockedRun(actor.compId);
  if (!locked) {
    return { status: "error", message: "Results are not locked yet, so there is no feedback to send." };
  }

  const [roster, judges, notes, captains] = await Promise.all([
    listRosterForBoard(actor),
    // Revoked judges included: their scores still counted, so their feedback still ships.
    listJudgeLabelsForBoard(actor),
    notesForBoard(actor),
    captainsByTeam(actor.compId),
  ]);

  const deductionReasons = new Map<string, string[]>();
  for (const deduction of locked.inputs.deductions) {
    const reasons = deductionReasons.get(deduction.teamId) ?? [];
    reasons.push(deduction.reason);
    deductionReasons.set(deduction.teamId, reasons);
  }

  const plan = planFeedbackDelivery(
    {
      runId: locked.id,
      placements: locked.results.placements,
      deductionReasons,
      judges: new Map(judges.map((judge) => [judge.assignmentId, judge.label])),
      scoredBy: new Set(locked.inputs.scores.map((score) => noteKey(score.judgeId, score.teamId))),
      notes,
    },
    roster,
    captains,
    { compName: actor.compName, boardName: actor.personName },
  );

  if (plan.send.length === 0) {
    return {
      status: "error",
      message:
        plan.skipped.length > 0
          ? `Nobody could be reached: ${plan.skipped.length} placed team(s) have no captain on file.`
          : "Nothing placed in the locked results, so there is no feedback to send.",
    };
  }

  let queued = 0;
  let already = 0;
  for (const target of plan.send) {
    const result = await enqueue({
      compId: actor.compId,
      personId: target.personId,
      template: "feedback.delivered",
      payload: target.payload,
      dedupeKey: target.dedupeKey,
      createdByPersonId: actor.personId,
    });
    if (result.ok) queued += 1;
    else if (result.reason === "duplicate") already += 1;
  }

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "feedback.deliver",
    entity: "tab_run",
    entityId: locked.id,
    after: { queued, already, skipped: plan.skipped.length },
  });

  revalidatePath(`${basePath}/results`);

  const parts = [
    queued > 0 ? `Feedback sent to ${queued} team${queued === 1 ? "" : "s"}` : null,
    already > 0 ? `${already} already had it for this result` : null,
    plan.skipped.length > 0
      ? `${plan.skipped.length} have no captain on file (${plan.skipped
          .map((row) => row.teamName)
          .join(", ")})`
      : null,
  ].filter((part) => part !== null);

  return { status: "ok", message: `${parts.join(" · ")}. No scores are included.` };
};
