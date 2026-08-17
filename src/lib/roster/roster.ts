import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import { db, withTransaction } from "@/db";
import type { TeamStatus } from "@/db/schema";
import { BILLABLE_STATUSES, PERFORMING_STATUSES, teams } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor, TeamActor } from "@/lib/auth/scope";
import { listRosterForBoard, ownTeamForCaptain, resolveRosterTeamForBoard } from "@/lib/auth/scope";
import { latestLockedRun } from "@/lib/comp/tab";
import { feeScheduleFor, syncCharges, today, voidChargesFor } from "@/lib/money/charges";
import { refusalFor, UNKNOWN_REFUSAL } from "@/lib/money/refusals";
import type { DrawCandidate, PositionRewrite } from "@/lib/schedule/draw";
import { move, redraw } from "@/lib/schedule/draw";
import type { MaterialsInput } from "./materials";
import {
  canTransition,
  dropFreesASlot,
  nextOffWaitlist,
  nextWaitlistRank,
  reorderWaitlist,
} from "./transitions";

export type RosterChange =
  | { ok: true; promoted: { id: string; name: string } | null }
  | { ok: false; message: string };

export type RosterMove = { ok: true } | { ok: false; message: string };

const LOCKED = "Results are locked. The roster can no longer change.";

const BILLABLE: readonly TeamStatus[] = BILLABLE_STATUSES;


/**
 * The rank for a team joining this comp's waitlist. Read-then-write, and deliberately not in a
 * transaction: two board members waitlisting two teams in the same second can both read the same
 * maximum and land on the same rank. That is a tie, not a fork -- `nextOffWaitlist` already breaks
 * ties by id, so the pair degrades to exactly the arbitrary-but-deterministic order that used to
 * govern the whole list, and every other team keeps its stated position.
 *
 * A `unique(comp_id, waitlist_rank)` would turn that tie into a *refusal*, which is the wrong
 * remedy: registration crush is when two people work the roster at once, and a board being told
 * "could not waitlist that team" because a colleague clicked first is worse than two teams sharing
 * rank 4. This is the same read-then-insert shape as `nextBidCode`, and the opposite call, because
 * a duplicate bid code is a broken identity and a duplicate rank is only an unstated preference.
 */
const appendToWaitlist = async (compId: string): Promise<number> => {
  const existing = await db
    .select({ waitlistRank: teams.waitlistRank })
    .from(teams)
    .where(and(eq(teams.compId, compId), eq(teams.status, "waitlisted")));

  return nextWaitlistRank(existing.map((t) => t.waitlistRank));
};

/**
 * Moves a team through the roster lifecycle, promoting off the waitlist when a slot comes free.
 *
 * Two guards come before anything is written.
 *
 * **The lock freezes the roster.** `tab_runs` holds the team list inside its frozen inputs, so a
 * roster that moved after a lock would describe a comp the locked result does not. The genuinely
 * dangerous case is reinstatement: `dropped -> accepted` after a lock hands a team back scores it
 * had already been given, which is precisely the bug ADR-0009 exists to prevent. `transitions.ts`
 * is free to permit reinstatement only because this door is shut first.
 *
 * **The `teamId` is a claim.** It resolves through `listRosterForBoard` -- the same scoped read that
 * produced the screen the claim arrived from -- because `teams.comp_id` is the only thing tying a
 * team to a comp and a form can name any uuid it likes.
 *
 * A team becoming `waitlisted` is appended to the end of the queue. It is not given back whatever
 * rank it held before, because the only routes in are `applied -> waitlisted` and
 * `dropped -> waitlisted`: the first never had one, and the second gave its place up when it was
 * dropped and does not get to reclaim it over teams that waited.
 */
export const setTeamStatus = async (
  actor: BoardActor,
  teamId: string,
  to: TeamStatus,
): Promise<RosterChange> => {
  if (await latestLockedRun(actor.compId)) return { ok: false, message: LOCKED };

  const team = await resolveRosterTeamForBoard(actor, teamId);
  if (!team) return { ok: false, message: "That team is not in this comp." };

  const from = team.status;
  if (!canTransition(from, to)) {
    return { ok: false, message: `A team that is ${from} cannot become ${to}.` };
  }

  const freesASlot = to === "dropped" && dropFreesASlot(from);
  const waitlistRank = to === "waitlisted" ? await appendToWaitlist(actor.compId) : null;

  // Read before the transaction opens: it is comp-level, unchanging for the duration of this move,
  // and holding a WebSocket open across it buys nothing. Null means the comp bills nothing, which
  // is the pre-money behaviour exactly -- no schedule, no charges, no billing work below.
  const schedule = await feeScheduleFor(actor.compId);
  const asOf = today();

  /**
   * Everything below is one transaction, and the non-transactional fast path is gone.
   *
   * It used to be defensible: a move that promotes nobody was one statement, and one statement is
   * atomic without asking. Obligations end that. `applied -> accepted` is now *"the team is accepted
   * **and** owes what the schedule says"*, an invariant spanning two statements, and half of it is
   * an accepted team owing nothing -- the exact orphan A3 exists to prevent, discovered in March by
   * a treasurer rather than in September by us.
   *
   * So this is ADR-0012's second caller doing what ADR-0012 described, and the guards above stay
   * *outside* it: the lock check and the claim check reject without opening a pool, because a
   * WebSocket handshake is expensive and a refused move must not pay for one.
   */
  return withTransaction(async (tx) => {
    const waitlisted = freesASlot
      ? await tx
          .select({ id: teams.id, name: teams.name, waitlistRank: teams.waitlistRank })
          .from(teams)
          .where(and(eq(teams.compId, actor.compId), eq(teams.status, "waitlisted")))
          .for("update")
      : [];

    const promotedTeamId = freesASlot ? nextOffWaitlist(waitlisted) : null;
    const promoted = waitlisted.find((t) => t.id === promotedTeamId) ?? null;

    await tx
      .update(teams)
      .set({ status: to, waitlistRank })
      .where(and(eq(teams.id, teamId), eq(teams.compId, actor.compId)));

    await recordAudit(
      {
        compId: actor.compId,
        actorKind: "board",
        actorPersonId: actor.personId,
        action: "team.status",
        entity: "team",
        entityId: teamId,
        before: { status: from },
        after: { status: to },
      },
      tx,
    );

    /**
     * The obligation half, in the same act as the status half.
     *
     * `-> dropped` voids: an obligation that outlives the team holding it is the orphan a treasurer
     * finds in April. Its allocations are untouched, which is what makes a team that paid and then
     * dropped read *the org owes you*, and what makes one that comes back read **paid, not owing** —
     * `charges_live_kind_unique` is partial on `voided_at is null`, so nothing blocks the regenerate
     * and nothing resurrects the old rows.
     *
     * `-> billable` generates. `accepted -> competing` regenerates and is a no-op by construction,
     * because `planCharges` keys on `(teamId, kind)` and the schedule has not changed — asserted in
     * the unit tests rather than assumed here.
     */
    if (schedule) {
      if (BILLABLE.includes(to)) {
        await syncCharges(tx, {
          compId: actor.compId,
          schedule,
          teams: [{ teamId, rosterSize: team.rosterSize, rooms: team.rooms }],
          asOf,
          reason: `team ${to}`,
        });
      } else {
        await voidChargesFor(tx, actor.compId, teamId, `team ${to}`);
      }
    }

    if (promoted) {
      await tx
        .update(teams)
        .set({ status: "accepted", waitlistRank: null })
        .where(and(eq(teams.id, promoted.id), eq(teams.compId, actor.compId)));

      // The promoted team's obligations are generated in the same act that gave it the slot. A
      // promotion that moved a team and not its bill is the reconciliation gap in miniature: the
      // acceptance doc says one thing and the money says another, which is PRD §14.
      if (schedule) {
        const [row] = await tx
          .select({ rosterSize: teams.rosterSize, rooms: teams.rooms })
          .from(teams)
          .where(eq(teams.id, promoted.id))
          .limit(1);

        await syncCharges(tx, {
          compId: actor.compId,
          schedule,
          teams: [{ teamId: promoted.id, rosterSize: row?.rosterSize ?? null, rooms: row?.rooms ?? null }],
          asOf,
          reason: "promoted off the waitlist",
        });
      }

      await recordAudit(
        {
          compId: actor.compId,
          actorKind: "board",
          actorPersonId: actor.personId,
          action: "team.promote",
          entity: "team",
          entityId: promoted.id,
          before: { status: "waitlisted" },
          after: { status: "accepted", filledSlotFrom: teamId },
        },
        tx,
      );
    }

    return { ok: true, promoted: promoted && { id: promoted.id, name: promoted.name } };
  });
};

/**
 * What a team is billed *on* — its dancer count and its room count.
 *
 * This exists because the money spine shipped with no way to state either. `rooms` had exactly one
 * writer in the whole repo, `src/db/seed.ts`, so every team that registered through the product was
 * permanently `hotel: not billed — room count unknown`: the engine withheld the line correctly and
 * nothing could ever answer it. At Mayuri's own schedule that is $560 a team the comp cannot charge.
 * `rosterSize` was one step better and the same shape — an applicant stated it once and nobody could
 * correct it, so roster churn between acceptance and the show billed the wrong registration total.
 *
 * Both are `null` for *not yet known*, never zero, which is `BillableTeam`'s distinction and the
 * reason a gap is a stated sentence rather than a $0 charge.
 *
 * The guards are `setTeamStatus`', for its reasons: the lock freezes the roster, and a `teamId` on a
 * form is a claim resolved against the window that produced the form. No fourth window is added —
 * A3 already widened `listRosterForBoard` to carry these columns, so this changes what is written
 * and not what is read.
 *
 * **The transaction is `setTeamStatus`' argument unchanged, not a third caller.** ADR-0012 counts by
 * invariant, and this writes the same one: *the team's billable facts, and what it therefore owes*.
 * Half of it is the orphan A3 exists to prevent, wearing different clothes — a team recorded as
 * having four rooms and billed for none, which a treasurer finds in April.
 *
 * A team outside `BILLABLE_STATUSES` gets the columns and no charges, which is `setTeamStatus`'
 * rule: an `applied` team's room count is worth recording the day it is known, and billing it is
 * what acceptance is for.
 */
/**
 * A billing write, with the database's refusal turned into a sentence rather than a stack trace.
 *
 * `charges_live_kind_unique` is what makes regenerating safe to click twice, and until now nothing
 * caught it: two board members regenerating at the same moment, or a status move racing a room
 * count, threw drizzle's own error — `Failed query: insert into "charges" ...` — straight at a
 * board member. The invariant held and the product looked broken, which is the failure mode
 * `violatedConstraint` exists for and the reason the ledger has read it since A8.
 */
const billingWrite = async <T extends { ok: boolean }>(
  write: (tx: Transaction) => Promise<T>,
): Promise<T | { ok: false; message: string }> => {
  try {
    return await withTransaction(write);
  } catch (error) {
    return { ok: false, message: refusalFor(error) ?? UNKNOWN_REFUSAL };
  }
};

export const setTeamBilling = async (
  actor: BoardActor,
  teamId: string,
  values: { rosterSize: number | null; rooms: number | null },
): Promise<RosterMove> => {
  if (await latestLockedRun(actor.compId)) return { ok: false, message: LOCKED };

  const team = await resolveRosterTeamForBoard(actor, teamId);
  if (!team) return { ok: false, message: "That team is not in this comp." };

  const schedule = await feeScheduleFor(actor.compId);
  const asOf = today();

  return billingWrite(async (tx) => {
    await tx
      .update(teams)
      .set({
        rosterSize: values.rosterSize,
        rooms: values.rooms,
        // Whatever the captain was asking for, the board has now stated the roster -- so the claim
        // is answered whether it was granted, changed or ignored. Clearing it here rather than in a
        // second write is what keeps A4 off the list of `withTransaction` callers: *state the
        // roster, bill it, and close the request* is one act, and it is this one.
        rosterSizeRequested: null,
      })
      .where(and(eq(teams.id, teamId), eq(teams.compId, actor.compId)));

    await recordAudit(
      {
        compId: actor.compId,
        actorKind: "board",
        actorPersonId: actor.personId,
        action: "team.billing",
        entity: "team",
        entityId: teamId,
        before: {
          rosterSize: team.rosterSize,
          rooms: team.rooms,
          rosterSizeRequested: team.rosterSizeRequested,
        },
        after: values,
      },
      tx,
    );

    if (schedule && BILLABLE.includes(team.status)) {
      await syncCharges(tx, {
        compId: actor.compId,
        schedule,
        teams: [{ teamId, rosterSize: values.rosterSize, rooms: values.rooms }],
        asOf,
        reason: "billing details changed",
      });
    }

    return { ok: true };
  });
};

/**
 * A4's materials half: what a team files after it is accepted.
 *
 * **It resolves through `ownTeamForCaptain`, which is not a fifth window and not even a claim to
 * check.** A captain's `teamId` rides on the actor, off a `memberships` row, so there is no id on
 * this form that could name somebody else's team -- the same reason the four comp-scoped board
 * writes resolve nothing. The read is still made, because a membership pointing at a team that was
 * deleted must fail here rather than write a row against a uuid.
 *
 * **Not a fifth `withTransaction` caller** (ADR-0012), and the argument has to be made rather than
 * assumed: this is one `UPDATE` of five columns on one row. Nothing else has to land with it. The
 * obligations these facts imply are generated when the *board* states the roster, which is
 * `setTeamBilling`'s transaction and already exists.
 *
 * **The lock splits this write in half, deliberately.** `teams` lives inside `tab_runs.inputs`, so
 * the roster freezes -- and a *requested* roster size is a request to change roster, which after a
 * lock can never be granted and must not sit on the board's screen implying otherwise. But music and
 * an emergency contact are in no `TabulationInput`, and comp day is exactly when somebody needs a
 * phone number. So the claim is refused after the lock and the materials are not.
 */
export const submitMaterials = async (
  actor: TeamActor,
  input: MaterialsInput,
): Promise<RosterMove> => {
  const team = await ownTeamForCaptain(actor);
  if (!team) return { ok: false, message: "That team is not in this comp." };

  if (input.rosterSizeRequested !== null && (await latestLockedRun(actor.compId))) {
    return {
      ok: false,
      message: "Results are locked, so the roster can no longer change. Everything else was saved.",
    };
  }

  await db
    .update(teams)
    .set({
      musicUrl: input.musicUrl,
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      rosterSizeRequested: input.rosterSizeRequested,
      materialsSubmittedAt: new Date(),
    })
    .where(and(eq(teams.id, actor.teamId), eq(teams.compId, actor.compId)));

  // The first `team` actor to write anything. `ACTOR_KINDS` has carried the kind since P1 and
  // `audit_log_actor_kind_check` derives from it, so this needs no migration -- the column was
  // widened for exactly this and had no writer until now.
  await recordAudit({
    compId: actor.compId,
    actorKind: "team",
    actorPersonId: actor.personId,
    action: "team.materials",
    entity: "team",
    entityId: actor.teamId,
    before: {
      musicUrl: team.musicUrl,
      emergencyContactName: team.emergencyContactName,
      emergencyContactPhone: team.emergencyContactPhone,
      rosterSizeRequested: team.rosterSizeRequested,
    },
    after: input,
  });

  return { ok: true };
};

/**
 * Brings every billable team's obligations back in line with the schedule.
 *
 * The gap this closes is that `syncCharges` had exactly two callers and both were inside
 * `setTeamStatus` — **a status transition was the only thing in the product that regenerated
 * charges**. So a late fee could not fire: `generateCharges` adds one when `asOf > lateAfter`, and a
 * team accepted in December is never re-planned, so the date passes in February and nothing bills
 * it. The who-owes screen could not show it either, because it recomputes *gaps* and reads owed from
 * live `charges` — under-billing with no line saying so, which is the failure the gaps exist to
 * prevent arriving through the one door they do not watch.
 *
 * Idempotent by construction rather than by care: `planCharges` keys on `(teamId, kind)` among live
 * charges, so a second run with nothing changed is `{insert: [], void: []}`. That is asserted in
 * `src/lib/fees/__tests__/schedule.test.ts` against the pure function, which is why this needs no
 * database to be sure of it.
 *
 * One transaction for the whole roster, because the invariant is the comp's rather than a team's:
 * half an applied regeneration is a comp where some teams carry a late fee and others do not, and
 * nothing on the screen would say which half ran.
 */
export const regenerateCharges = async (
  actor: BoardActor,
): Promise<{ ok: true; inserted: number; voided: number } | { ok: false; message: string }> => {
  if (await latestLockedRun(actor.compId)) return { ok: false, message: LOCKED };

  const schedule = await feeScheduleFor(actor.compId);
  if (!schedule) return { ok: false, message: "This comp has no fee schedule, so it bills nothing." };

  const billable = (await listRosterForBoard(actor)).filter((team) =>
    BILLABLE.includes(team.status),
  );
  if (billable.length === 0) {
    return { ok: false, message: "No team on this roster is billable yet." };
  }

  const asOf = today();

  return billingWrite(async (tx) => {
    const plan = await syncCharges(tx, {
      compId: actor.compId,
      schedule,
      teams: billable.map((team) => ({
        teamId: team.id,
        rosterSize: team.rosterSize,
        rooms: team.rooms,
      })),
      asOf,
      reason: "charges regenerated",
    });

    await recordAudit(
      {
        compId: actor.compId,
        actorKind: "board",
        actorPersonId: actor.personId,
        action: "charges.regenerate",
        entity: "comp",
        entityId: actor.compId,
        before: { asOf, teams: billable.length },
        after: {
          inserted: plan.insert.length,
          voided: plan.void.length,
          unchanged: plan.unchanged.length,
        },
      },
      tx,
    );

    return { ok: true as const, inserted: plan.insert.length, voided: plan.void.length };
  });
};

/**
 * Moves one team one place along its comp's waitlist.
 *
 * The two guards are `setTeamStatus`'s, and for its reasons: a rank *is* roster, so the lock freezes
 * it, and a `teamId` on a form is a claim that resolves through the same scoped read that produced
 * the screen it arrived from. The third guard is this function's own -- rank is only meaningful for
 * a waitlisted team, and a board that has just watched one get promoted should be told that rather
 * than have the click silently do nothing.
 *
 * **This writes many rows and still does not open a transaction**, which is the one thing here worth
 * arguing rather than assuming. `withTransaction` exists for writes whose invariant spans statements
 * (ADR-0012), and a reorder's does not span anything: `reorderWaitlist` returns a set of rewrites
 * that are applied as a single `case` expression, and one statement is atomic on neon-http without
 * asking for anything. The transaction stays what ADR-0012 wanted it to be -- the exception.
 *
 * What can still go wrong is bounded and deliberately tolerated. A team promoted off the waitlist
 * between the read and the write drops out of the `where`, so its half of a trade is skipped and the
 * pair ends up sharing a rank. That is a tie, which `byWaitlistOrder` already breaks by id and which
 * a second click resolves -- the same call `appendToWaitlist` makes, for the same reason: refusing a
 * board mid-registration is worse than an unstated preference between two teams.
 */
export const setWaitlistRank = async (
  actor: BoardActor,
  teamId: string,
  direction: "up" | "down",
): Promise<RosterMove> => {
  if (await latestLockedRun(actor.compId)) return { ok: false, message: LOCKED };

  const team = await resolveRosterTeamForBoard(actor, teamId);
  if (!team) return { ok: false, message: "That team is not in this comp." };

  if (team.status !== "waitlisted") {
    return { ok: false, message: `A team that is ${team.status} is not on the waitlist.` };
  }

  const waitlisted = await db
    .select({ id: teams.id, waitlistRank: teams.waitlistRank })
    .from(teams)
    .where(and(eq(teams.compId, actor.compId), eq(teams.status, "waitlisted")));

  const rewrites = reorderWaitlist(waitlisted, teamId, direction);
  if (rewrites.length === 0) {
    const end = direction === "up" ? "top" : "bottom";
    return { ok: false, message: `${team.name} is already at the ${end} of the waitlist.` };
  }

  // Cast the rank explicitly: every branch of the `case` is a bound parameter, so without it
  // Postgres has nothing to infer an integer from and resolves the whole expression to text.
  await db
    .update(teams)
    .set({
      waitlistRank: sql`case ${sql.join(
        rewrites.map((r) => sql`when ${teams.id} = ${r.id} then ${r.waitlistRank}::integer`),
        sql` `,
      )} end`,
    })
    .where(
      and(
        eq(teams.compId, actor.compId),
        eq(teams.status, "waitlisted"),
        inArray(
          teams.id,
          rewrites.map((r) => r.id),
        ),
      ),
    );

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "team.rank",
    entity: "team",
    entityId: teamId,
    before: { waitlistRank: team.waitlistRank },
    // The whole rewrite, not just this team's: a trade moves two rows and a re-space can move more,
    // and an audit row that named only the team the board clicked would not explain the others.
    after: { direction, rewrites },
  });

  return { ok: true };
};

/** The next bid code for a comp: registration has to mint one, and they are unique per comp. */
export const nextBidCode = async (compId: string): Promise<string> => {
  const existing = await db
    .select({ bidCode: teams.bidCode })
    .from(teams)
    .where(and(eq(teams.compId, compId), ne(teams.bidCode, "")));

  const used = new Set(existing.map((t) => t.bidCode));
  for (let n = 1; ; n++) {
    const code = `T-${String(n).padStart(3, "0")}`;
    if (!used.has(code)) return code;
  }
};

/**
 * G1 — the Friday-night draw, written down.
 *
 * **Not a fourth window.** `RosterTeamView` already carries `performanceOrder`, so *which team dances
 * third* asks no new question about which teams count; it is A3's argument again, one column over.
 * Both writes below resolve against `listRosterForBoard`, which is what makes another comp's team and
 * a team that is not in this draw refusals rather than checks somebody has to remember to write.
 *
 * **Refused after the lock**, for `setWaitlistRank`'s reason and more sharply: `teams` lives inside
 * `tab_runs.inputs` and `performance_order` is on `teams`, so re-drawing after a lock would describe
 * a comp the locked result does not.
 */
const drawCandidates = async (actor: BoardActor): Promise<DrawCandidate[]> =>
  (await listRosterForBoard(actor))
    .filter((team) => (PERFORMING_STATUSES as readonly TeamStatus[]).includes(team.status))
    .map((team) => ({
      teamId: team.id,
      position: team.performanceOrder,
      bidCode: team.bidCode,
    }));

/**
 * Writes a set of position rewrites as one statement.
 *
 * One statement, not a transaction, and that is what `teams_comp_performance_order_unique` being
 * `DEFERRABLE INITIALLY DEFERRED` buys: a trade holds two teams at the same position halfway through
 * the UPDATE, and a non-deferred unique rejects it. Deferred, the check lands at the end of the
 * implicit transaction the statement already is — so the sanctioned `withTransaction` callers stay at
 * four.
 *
 * The explicit `::integer` cast is `setWaitlistRank`'s: every branch of the `case` is a bound
 * parameter, so without it Postgres has nothing to infer from and resolves the whole expression to
 * text.
 */
const applyPositions = async (
  actor: BoardActor,
  rewrites: readonly PositionRewrite[],
): Promise<void> => {
  await db
    .update(teams)
    .set({
      performanceOrder: sql`case ${sql.join(
        rewrites.map((r) => sql`when ${teams.id} = ${r.teamId} then ${r.position}::integer`),
        sql` `,
      )} end`,
    })
    .where(
      and(
        eq(teams.compId, actor.compId),
        inArray(
          teams.id,
          rewrites.map((r) => r.teamId),
        ),
      ),
    );
};

/**
 * States the whole running order, `1..N`, in the sequence the board gives.
 *
 * This is the bulk act: a board typing in what the mixer game produced, or closing the hole a drop
 * left behind. Callboard **ingests** the draw and does not run it (`docs/ROADMAP.md`'s one exception
 * to the tarpit), so there is no randomness here and there could not be — `src/lib/schedule/` is
 * fenced against it.
 *
 * A team the board does not name keeps a slot at the end rather than losing one. A draw that silently
 * dropped a team from the running order is the class of failure this product exists to prevent, and
 * it would surface on stage rather than on a screen.
 */
export const setShowOrder = async (actor: BoardActor, order: readonly string[]): Promise<RosterMove> => {
  if (await latestLockedRun(actor.compId)) return { ok: false, message: LOCKED };

  const candidates = await drawCandidates(actor);
  if (candidates.length === 0) {
    return { ok: false, message: "No team is accepted yet, so there is no running order to draw." };
  }

  const rewrites = redraw(candidates, order);
  if (rewrites.length === 0) return { ok: true };

  await applyPositions(actor, rewrites);

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "comp.draw",
    entity: "comp",
    entityId: actor.compId,
    before: { order: candidates.map((c) => ({ teamId: c.teamId, position: c.position })) },
    after: { rewrites },
  });

  return { ok: true };
};

/**
 * Moves one team one place up or down the running order.
 *
 * A **trade**, never a renumber — `setWaitlistRank`'s rule, and the stakes are higher here. A running
 * order is read off a printed sheet by an emcee and off a phone by every liaison, so renumbering the
 * whole show to move one act is how six people end up holding different answers to *when do I walk*.
 */
export const moveInShowOrder = async (
  actor: BoardActor,
  teamId: string,
  direction: "up" | "down",
): Promise<RosterMove> => {
  if (await latestLockedRun(actor.compId)) return { ok: false, message: LOCKED };

  const team = await resolveRosterTeamForBoard(actor, teamId);
  if (!team) return { ok: false, message: "That team is not in this comp." };
  if (team.performanceOrder === null) {
    return { ok: false, message: `${team.name} is not in the running order yet.` };
  }

  const rewrites = move(await drawCandidates(actor), teamId, direction);
  if (rewrites.length === 0) {
    const end = direction === "up" ? "start" : "end";
    return { ok: false, message: `${team.name} is already at the ${end} of the running order.` };
  }

  await applyPositions(actor, rewrites);

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "team.showorder",
    entity: "team",
    entityId: teamId,
    before: { performanceOrder: team.performanceOrder },
    // The whole trade, not just the team the board clicked: a trade moves two rows and an audit row
    // naming one of them would not explain the other.
    after: { direction, rewrites },
  });

  return { ok: true };
};
