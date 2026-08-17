import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { violatedConstraint } from "@/db/errors";
import { ASSIGNMENT_CONSTRAINTS, assignments, comps, people, teams } from "@/db/schema";
import type { DutyCategory, DutyConfig } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { planAssignment } from "./duties";

export type CoordResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** One assigned duty, as a board reads it: who, what, when, and how far along. */
export type BoardAssignmentView = {
  id: string;
  personId: string;
  personName: string;
  dutyId: string;
  category: DutyCategory;
  teamId: string | null;
  teamName: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  note: string | null;
  swaTrainedAt: Date | null;
  acknowledgedAt: Date | null;
  completedAt: Date | null;
};

const now = (): Date => new Date();

/**
 * Every live duty at this comp.
 *
 * **Not a window.** It takes scope from `actor.compId` and resolves no id, which is
 * `listInvitationsForBoard`'s shape rather than `listRosterForBoard`'s: a board that already reads
 * its own roster, its own money and its own audit log reading its own comp's duty list asks no new
 * question about which rows count. The ids arriving on the forms below resolve one level down *this*
 * read, which is what keeps the rule's sentence literally true.
 */
export const listAssignmentsForBoard = async (actor: {
  compId: string;
}): Promise<BoardAssignmentView[]> => {
  const rows = await db
    .select({
      id: assignments.id,
      personId: assignments.personId,
      personName: people.name,
      dutyId: assignments.dutyId,
      category: assignments.category,
      teamId: assignments.teamId,
      teamName: teams.name,
      startsAt: assignments.startsAt,
      endsAt: assignments.endsAt,
      note: assignments.note,
      swaTrainedAt: assignments.swaTrainedAt,
      acknowledgedAt: assignments.acknowledgedAt,
      completedAt: assignments.completedAt,
    })
    .from(assignments)
    .innerJoin(people, eq(people.id, assignments.personId))
    .leftJoin(teams, eq(teams.id, assignments.teamId))
    .where(and(eq(assignments.compId, actor.compId), isNull(assignments.revokedAt)))
    .orderBy(asc(people.name), asc(assignments.dutyId));

  return rows;
};

/** A duty a board can resolve an id against — the array holds only this comp's live rows. */
export const resolveAssignmentForBoard = async (
  actor: { compId: string },
  assignmentId: string,
): Promise<BoardAssignmentView | null> =>
  (await listAssignmentsForBoard(actor)).find((a) => a.id === assignmentId) ?? null;

/** The comp's stated vocabulary. A comp that never declared one coordinates nobody. */
export const dutiesForComp = async (compId: string): Promise<DutyConfig[] | null> => {
  const [row] = await db
    .select({ duties: comps.duties })
    .from(comps)
    .where(eq(comps.id, compId))
    .limit(1);
  return row?.duties ?? null;
};

/**
 * Put a person on a duty.
 *
 * One INSERT and an audit row, so **no `withTransaction`**: the four sanctioned callers each have an
 * invariant that genuinely spans statements, and this has none. A duty that is assigned but whose
 * audit row failed is a tidiness problem a board can see on the screen — not an accepted team owing
 * nothing, which is what the roster's transaction exists to prevent.
 *
 * `personId` and `teamId` are claims and are resolved by the caller against reads that already
 * exist. What is checked *here* is the pairing of duty to team, because that is a fact about the
 * comp's own vocabulary rather than about which rows the actor may see.
 */
export const assignDuty = async (
  actor: { compId: string; personId: string },
  input: {
    personId: string;
    dutyId: string;
    teamId: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    note: string | null;
  },
): Promise<CoordResult<{ id: string }>> => {
  const plan = planAssignment(await dutiesForComp(actor.compId), input.dutyId, input.teamId);
  if (!plan.ok) return plan;

  if (input.endsAt && !input.startsAt) {
    return { ok: false, message: "A duty that ends needs a time it starts." };
  }
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
    return { ok: false, message: "A duty cannot end before it starts." };
  }

  try {
    const [row] = await db
      .insert(assignments)
      .values({
        compId: actor.compId,
        personId: input.personId,
        dutyId: plan.value.dutyId,
        category: plan.value.category,
        teamId: plan.value.teamId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note,
        createdByPersonId: actor.personId,
      })
      .returning({ id: assignments.id });

    if (!row) return { ok: false, message: "That duty was not assigned. Try again." };

    await recordAudit({
      compId: actor.compId,
      actorKind: "board",
      actorPersonId: actor.personId,
      action: "duty.assign",
      entity: "assignment",
      entityId: row.id,
      before: null,
      after: { personId: input.personId, dutyId: plan.value.dutyId, teamId: plan.value.teamId },
    });

    return { ok: true, value: { id: row.id } };
  } catch (error) {
    // Both indexes mean the same sentence to a board, which is why they share one. The pair exists
    // because Postgres treats NULLs as distinct, not because they are two rules.
    const constraint = violatedConstraint(error);
    if (
      constraint === ASSIGNMENT_CONSTRAINTS.liveDuty ||
      constraint === ASSIGNMENT_CONSTRAINTS.liveDutyNoTeam
    ) {
      return { ok: false, message: "That person already has that duty." };
    }
    throw error;
  }
};

/**
 * Take a duty back. `revoked_at`, never `DELETE` — deleting one somebody already acknowledged
 * destroys the record that they were told to be somewhere, which is the record a board needs most
 * on the day nobody was.
 */
export const revokeDuty = async (
  actor: { compId: string; personId: string },
  assignmentId: string,
): Promise<CoordResult<null>> => {
  const [row] = await db
    .update(assignments)
    .set({ revokedAt: now() })
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.compId, actor.compId),
        isNull(assignments.revokedAt),
      ),
    )
    .returning({ id: assignments.id });

  if (!row) return { ok: false, message: "That duty is already gone." };

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "duty.revoke",
    entity: "assignment",
    entityId: assignmentId,
    before: null,
    after: null,
  });

  return { ok: true, value: null };
};

/**
 * Record that somebody has done the SWA training, or that they have not after all.
 *
 * A timestamp rather than a boolean, and reversible for `reconciled_at`'s reason: the mark records
 * an event a board observed, and a board that marked the wrong person needs to be able to say so.
 */
export const setSwaTrained = async (
  actor: { compId: string; personId: string },
  assignmentId: string,
  trained: boolean,
): Promise<CoordResult<null>> => {
  const [row] = await db
    .update(assignments)
    .set({ swaTrainedAt: trained ? now() : null })
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.compId, actor.compId),
        isNull(assignments.revokedAt),
      ),
    )
    .returning({ id: assignments.id });

  if (!row) return { ok: false, message: "That duty is no longer here." };

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "duty.swa",
    entity: "assignment",
    entityId: assignmentId,
    before: null,
    after: { trained },
  });

  return { ok: true, value: null };
};

/**
 * A liaison says they have seen a duty, or that they have done it.
 *
 * **One guarded `UPDATE` each, and the guard is the serialization point** — `releaseAllocation`'s
 * and `claim`'s shape. `where acknowledged_at is null` means a double-clicked button writes once and
 * the timestamp does not move; a read-then-write here would have two acts and a race between them,
 * and the wrong answer is a record saying somebody acknowledged a duty at a time they did not.
 *
 * Completing sets `acknowledged_at` in the *same statement* when it is still null, which is what
 * makes `assignments_progress_check` true by construction rather than by the caller remembering: a
 * liaison who marks a duty done without opening it first has, in fact, seen it.
 *
 * `actorKind: "liaison"` needs no migration — P1 put it in `ACTOR_KINDS` and the CHECK derives from
 * that list. These are the only two writes a liaison makes in this product.
 */
const liaisonMark = async (
  actor: { compId: string; personId: string },
  assignmentId: string,
  action: "duty.acknowledge" | "duty.complete",
): Promise<CoordResult<null>> => {
  const at = now();
  const complete = action === "duty.complete";

  const [row] = await db
    .update(assignments)
    .set(
      complete
        ? { completedAt: at, acknowledgedAt: sql`coalesce(${assignments.acknowledgedAt}, ${at})` }
        : { acknowledgedAt: at },
    )
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.compId, actor.compId),
        eq(assignments.personId, actor.personId),
        isNull(assignments.revokedAt),
        complete ? isNull(assignments.completedAt) : isNull(assignments.acknowledgedAt),
      ),
    )
    .returning({ id: assignments.id });

  // Not an error, and deliberately: a second click is what a person on a phone with a slow
  // connection does, and `enqueue`'s `duplicate` is the precedent -- the screen says it is already
  // recorded rather than showing red.
  if (!row) return { ok: false, message: complete ? "Already marked done." : "Already acknowledged." };

  await recordAudit({
    compId: actor.compId,
    actorKind: "liaison",
    actorPersonId: actor.personId,
    action,
    entity: "assignment",
    entityId: assignmentId,
    before: null,
    after: null,
  });

  return { ok: true, value: null };
};

export const acknowledgeDuty = (
  actor: { compId: string; personId: string },
  assignmentId: string,
): Promise<CoordResult<null>> => liaisonMark(actor, assignmentId, "duty.acknowledge");

export const completeDuty = (
  actor: { compId: string; personId: string },
  assignmentId: string,
): Promise<CoordResult<null>> => liaisonMark(actor, assignmentId, "duty.complete");
