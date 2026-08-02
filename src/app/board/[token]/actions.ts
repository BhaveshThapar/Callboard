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
import { invite, orgOfComp } from "@/lib/auth/accounts";
import type { AccountRole } from "@/db/schema";
import { ACCOUNT_ROLES } from "@/db/schema";
import type { DepositState } from "@/lib/money/deposit";
import { DEPOSIT_STATES } from "@/lib/money/deposit";
import { advanceDeposit } from "@/lib/money/deposits";
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
  NOT_COMPETING,
  resolveBoardActor,
  resolveRosterTeamForBoard,
  resolveTeamForBoard,
} from "@/lib/auth/scope";
import { setCompStatus } from "@/lib/comp/status";
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
  const token = String(formData.get("token") ?? "");
  const to = String(formData.get("status") ?? "");

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

  if (!COMP_STATUSES.includes(to as CompStatus)) {
    return { status: "error", message: "That is not a comp status." };
  }

  const result = await setCompStatus(actor, to as CompStatus);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`/board/${token}`);
  revalidatePath(`/board/${token}/roster`);
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
  const token = String(formData.get("token") ?? "");
  const teamId = String(formData.get("teamId") ?? "");

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };
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

  revalidatePath(`/board/${token}/roster`);
  revalidatePath(`/board/${token}/money`);
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
  const token = String(formData.get("token") ?? "");

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

  const result = await regenerateCharges(actor);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`/board/${token}/money`);
  revalidatePath(`/board/${token}/roster`);

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
  const token = String(formData.get("token") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const rail = String(formData.get("rail") ?? "");
  const externalRef = String(formData.get("externalRef") ?? "").trim();

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

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

  revalidatePath(`/board/${token}/money`);
  revalidatePath(`/board/${token}/roster`);
  return {
    status: "ok",
    message:
      result.creditCents > 0
        ? `Recorded. ${formatCents(result.creditCents)} of it is not attached to anything yet.`
        : "Recorded.",
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
  const token = String(formData.get("token") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };
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

  revalidatePath(`/board/${token}/money`);
  revalidatePath(`/board/${token}/roster`);
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
  const token = String(formData.get("token") ?? "");
  const allocationId = String(formData.get("allocationId") ?? "");

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };
  if (!allocationId) return { status: "error", message: "Pick an allocation to release." };

  const result = await releaseAllocation(actor, allocationId);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`/board/${token}/money`);
  revalidatePath(`/board/${token}/roster`);
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
  const token = String(formData.get("token") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const reconciled = String(formData.get("reconciled") ?? "") === "true";

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };
  if (!paymentId) return { status: "error", message: "Pick a payment." };

  const result = await setPaymentReconciled(actor, paymentId, reconciled);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`/board/${token}/money`);
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
  const token = String(formData.get("token") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const to = String(formData.get("state") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

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

  revalidatePath(`/board/${token}/money`);
  revalidatePath(`/board/${token}/roster`);
  return {
    status: "ok",
    message:
      result.state === "refunded"
        ? "Deposit returned. It is no longer owed and no longer counted as paid."
        : `Deposit is now ${result.state.replace("_", " ")}.`,
  };
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
  const token = String(formData.get("token") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const teamId = String(formData.get("teamId") ?? "").trim();

  const actor = await resolveBoardActor(token);
  if (!actor) return { status: "error", message: "This board link is no longer valid." };

  if (!ACCOUNT_ROLES.includes(role as AccountRole)) {
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
    { email, name, role: role as AccountRole, teamId: role === "captain" ? teamId : null },
  );
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath(`/board/${token}/people`);
  return {
    status: "ok",
    // The link is shown once, exactly as a seeded token is: only its sha256 is stored, so nothing
    // in the product can recover it afterwards. Until the comms engine exists, a human sends it.
    message: `Invitation for ${email}: ${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/invite/${result.value.token}`,
  };
};
