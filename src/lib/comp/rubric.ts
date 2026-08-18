/**
 * P2's one genuinely missing piece — the rubric builder.
 *
 * The map's P2 row asked for three things and **two already existed**: roster import is A11's
 * `/import`, board-account management is the People screen. Only this was absent, and it was absent
 * in the strongest sense — `rubrics` and `rubric_criteria` had exactly one writer in the repo,
 * `src/db/seed.ts`, so authoring a rubric meant a founder editing a config file and running a seed.
 * A seed replaces the comp ([ADR-0013](../../../docs/decisions/0013-a-seed-replaces-a-comp-not-an-org.md)),
 * so changing one criterion destroyed the comp it belonged to.
 *
 * The database side of `src/lib/rubric/`, split the way `src/lib/comp/tab.ts` is split from
 * `src/lib/tabulation/`.
 */
import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor } from "@/lib/auth/scope";
import { latestLockedRun } from "@/lib/comp/tab";
import type { CriterionEdit, CriterionState } from "@/lib/rubric/plan";
import { planRubric } from "@/lib/rubric/plan";
import type { NormalizationMethod, Tiebreaker } from "@/lib/tabulation/types";
import { rubricCriteria, rubrics, scores } from "@/db/schema";

export type RubricView = {
  id: string;
  name: string;
  normalization: NormalizationMethod;
  tiebreakers: Tiebreaker[];
  criteria: CriterionState[];
  /** Every edit is refused once a run exists, so the screen says so rather than offering a form. */
  locked: boolean;
};

export type RubricResult = { ok: true } | { ok: false; message: string };

/**
 * The comp's rubric, with a score count against every criterion.
 *
 * The count is the whole point of this read: it is what `planRubric` refuses on, and it has to come
 * from the same query the form was built from — otherwise a board is shown "0 scores" and refused on
 * 24, which reads as the product being broken rather than as somebody having scored in between.
 *
 * Scoped by `actor.compId`, and it resolves nothing else: the subject is the actor's own comp, which
 * is `setCompStatus`' and `regenerateCharges`' shape. There is no id on the form to check.
 */
export const rubricForBoard = async (actor: BoardActor): Promise<RubricView | null> => {
  const [rubric] = await db
    .select({
      id: rubrics.id,
      name: rubrics.name,
      normalization: rubrics.normalization,
      tiebreakers: rubrics.tiebreakers,
    })
    .from(rubrics)
    .where(eq(rubrics.compId, actor.compId));

  if (!rubric) return null;

  const criteria = await db
    .select({
      id: rubricCriteria.id,
      label: rubricCriteria.label,
      maxPoints: rubricCriteria.maxPoints,
      weightBp: rubricCriteria.weightBp,
      sortOrder: rubricCriteria.sortOrder,
      scoreCount: count(scores.id),
    })
    .from(rubricCriteria)
    .leftJoin(scores, eq(scores.criterionId, rubricCriteria.id))
    .where(eq(rubricCriteria.rubricId, rubric.id))
    .groupBy(rubricCriteria.id)
    .orderBy(rubricCriteria.sortOrder, rubricCriteria.label);

  return {
    ...rubric,
    criteria,
    locked: (await latestLockedRun(actor.compId)) !== null,
  };
};

/**
 * Applies a board's edit to its own rubric.
 *
 * **Not a `withTransaction` caller, and the reason is worth stating rather than assumed.** The
 * writes here are independent rows in one table: a half-applied edit leaves a rubric that is
 * *different from what was asked for*, which a board can see and fix, rather than a rubric that is
 * *internally inconsistent*, which is the shape ADR-0012 reserves transactions for. Compare the
 * roster, where a status and the obligations it implies must land together or an accepted team owes
 * nothing.
 *
 * The delete runs last and is scoped by `inArray` **and** by `rubricId`. The scoping is belt and
 * braces over a plan that already resolved every id against `rubricForBoard`, and it is there
 * because of what the cascade does if an id ever escapes: `scores.criterion_id` is
 * `onDelete: cascade`, so a wrong id here does not error, it removes a judge's work and reports
 * success.
 */
export const setRubric = async (
  actor: BoardActor,
  input: {
    name: string;
    normalization: NormalizationMethod;
    criteria: CriterionEdit[];
  },
): Promise<RubricResult> => {
  const current = await rubricForBoard(actor);
  if (!current) {
    return { ok: false, message: "This comp has no rubric yet. Seed one before editing it." };
  }

  if (input.name.trim() === "") {
    return { ok: false, message: "A rubric needs a name." };
  }

  const plan = planRubric(current.criteria, input.criteria, { locked: current.locked });
  if (!plan.ok) return plan;

  await db
    .update(rubrics)
    .set({ name: input.name.trim(), normalization: input.normalization })
    .where(and(eq(rubrics.id, current.id), eq(rubrics.compId, actor.compId)));

  for (const criterion of plan.insert) {
    await db.insert(rubricCriteria).values({
      rubricId: current.id,
      label: criterion.label.trim(),
      maxPoints: criterion.maxPoints,
      weightBp: criterion.weightBp,
      sortOrder: criterion.sortOrder,
    });
  }

  for (const criterion of plan.update) {
    await db
      .update(rubricCriteria)
      .set({
        label: criterion.label.trim(),
        maxPoints: criterion.maxPoints,
        weightBp: criterion.weightBp,
        sortOrder: criterion.sortOrder,
      })
      .where(and(eq(rubricCriteria.id, criterion.id), eq(rubricCriteria.rubricId, current.id)));
  }

  if (plan.delete.length > 0) {
    await db
      .delete(rubricCriteria)
      .where(
        and(inArray(rubricCriteria.id, plan.delete), eq(rubricCriteria.rubricId, current.id)),
      );
  }

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "rubric.edit",
    entity: "rubric",
    entityId: current.id,
    before: {
      name: current.name,
      normalization: current.normalization,
      criteria: current.criteria,
    },
    after: {
      name: input.name.trim(),
      normalization: input.normalization,
      inserted: plan.insert.length,
      updated: plan.update.length,
      deleted: plan.delete.length,
    },
  });

  return { ok: true };
};

/** Kept for the seed's shape; the builder never writes a tiebreaker it did not read. */
export const tiebreakersFor = async (compId: string): Promise<Tiebreaker[]> => {
  const [row] = await db
    .select({ tiebreakers: rubrics.tiebreakers })
    .from(rubrics)
    .where(eq(rubrics.compId, compId));
  return row?.tiebreakers ?? [];
};
