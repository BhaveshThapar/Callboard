import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, withTransaction } from "@/db";
import type { TeamStatus } from "@/db/schema";
import { BILLABLE_STATUSES, teams } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor } from "@/lib/auth/scope";
import { resolveRosterTeamForBoard } from "@/lib/auth/scope";
import { latestLockedRun } from "@/lib/comp/tab";
import { feeScheduleFor, syncCharges, today, voidChargesFor } from "@/lib/money/charges";
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
