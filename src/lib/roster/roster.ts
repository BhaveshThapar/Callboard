import { and, eq, ne } from "drizzle-orm";
import { db, withTransaction } from "@/db";
import type { TeamStatus } from "@/db/schema";
import { teams } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor } from "@/lib/auth/scope";
import { resolveRosterTeamForBoard } from "@/lib/auth/scope";
import { latestLockedRun } from "@/lib/comp/tab";
import { canTransition, dropFreesASlot, nextOffWaitlist, nextWaitlistRank } from "./transitions";

export type RosterChange =
  | { ok: true; promoted: { id: string; name: string } | null }
  | { ok: false; message: string };

const LOCKED = "Results are locked. The roster can no longer change.";

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

  // A team that never held a slot frees none, so nothing is promoted and one statement will do.
  if (!(to === "dropped" && dropFreesASlot(from))) {
    await db
      .update(teams)
      .set({
        status: to,
        waitlistRank: to === "waitlisted" ? await appendToWaitlist(actor.compId) : null,
      })
      .where(and(eq(teams.id, teamId), eq(teams.compId, actor.compId)));

    await recordAudit({
      compId: actor.compId,
      actorKind: "board",
      actorPersonId: actor.personId,
      action: "team.status",
      entity: "team",
      entityId: teamId,
      before: { status: from },
      after: { status: to },
    });

    return { ok: true, promoted: null };
  }

  /**
   * The drop frees a slot, so the waitlist moves — and the two have to move together. This is the
   * write ADR-0012 exists for: half of it is a comp that has lost a team and not replaced it, and
   * the other half is a comp with one more accepted team than it has slots. Both are states a human
   * would have to find and repair by hand, which is the reconciliation problem this product is
   * being sold to end.
   *
   * The waitlist is read `for update` inside the transaction, so two board members dropping two
   * different teams at the same moment cannot both promote the same team into two slots.
   */
  return withTransaction(async (tx) => {
    const waitlisted = await tx
      .select({ id: teams.id, name: teams.name, waitlistRank: teams.waitlistRank })
      .from(teams)
      .where(and(eq(teams.compId, actor.compId), eq(teams.status, "waitlisted")))
      .for("update");

    const promotedTeamId = nextOffWaitlist(waitlisted);
    const promoted = waitlisted.find((t) => t.id === promotedTeamId) ?? null;

    await tx
      .update(teams)
      .set({ status: "dropped", waitlistRank: null })
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
        after: { status: "dropped" },
      },
      tx,
    );

    if (promoted) {
      await tx
        .update(teams)
        .set({ status: "accepted", waitlistRank: null })
        .where(and(eq(teams.id, promoted.id), eq(teams.compId, actor.compId)));

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
