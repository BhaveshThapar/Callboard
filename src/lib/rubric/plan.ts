/**
 * P2 — what a board may change about its own rubric, and when it may not.
 *
 * Pure, and **deliberately not a fourth ESLint pure zone**, on `src/lib/coord/duties.ts`' test: a
 * zone protects *reproducibility of a number somebody is billed or ranked by*, and this decides
 * whether an edit is allowed rather than what any number is. The rubric that a locked run reproduces
 * from is the frozen copy in `tab_runs.config`, which nothing here can reach.
 *
 * The rules exist because of one line in the schema:
 *
 *     criterionId: uuid("criterion_id").references(() => rubricCriteria.id, { onDelete: "cascade" })
 *
 * **Deleting a criterion deletes every score against it, silently.** That is the right cascade for
 * dropping a whole comp and the wrong one for a board tidying up a rubric mid-season, and the
 * difference cannot be expressed in the foreign key. So it is expressed here, and the database's
 * answer is never the one relied on.
 */

export type CriterionState = {
  id: string;
  label: string;
  maxPoints: number;
  weightBp: number;
  sortOrder: number;
  /** How many scores already reference this criterion. The whole rule set turns on this. */
  scoreCount: number;
};

export type CriterionEdit = {
  /** Absent for a criterion being added. */
  id?: string;
  label: string;
  maxPoints: number;
  weightBp: number;
  sortOrder: number;
};

export type RubricRefusal = { ok: false; message: string };
export type RubricPlan = {
  ok: true;
  insert: CriterionEdit[];
  update: (CriterionEdit & { id: string })[];
  delete: string[];
  unchanged: string[];
};

const BASIS_POINTS = 10_000;

/**
 * What a board's submitted rubric would do to the one that exists.
 *
 * Three refusals, and each is a different kind of wrong:
 *
 * - **A locked comp refuses everything.** Not because it would corrupt the locked run — that
 *   reproduces from its own frozen `config` and cannot be reached from here — but because the edit
 *   would be *invisible*: it changes nothing anybody can see, while looking like it changed the
 *   thing the placements came from.
 * - **A scored criterion cannot be deleted.** The cascade would take the scores with it and the
 *   board would be told it worked. A judge's score is evidence; the rubric is a description of what
 *   was asked. Deleting the description must not destroy the evidence.
 * - **A scored criterion cannot be re-scaled.** A 24 out of 30 is not a 24 out of 50, and `maxPoints`
 *   is what the z-score normalizes against — so moving it silently restates every score already
 *   given. The **label** stays editable, because rewording a question does not change the answers,
 *   which is `CustomField`'s own rule about ids and labels one table over.
 */
export const planRubric = (
  current: readonly CriterionState[],
  submitted: readonly CriterionEdit[],
  options: { locked: boolean },
): RubricPlan | RubricRefusal => {
  if (options.locked) {
    return {
      ok: false,
      message:
        "Results are locked, so the rubric can no longer change. A locked result reproduces from its own frozen copy, so an edit here would change nothing anybody can see.",
    };
  }

  if (submitted.length === 0) {
    return { ok: false, message: "A rubric needs at least one criterion." };
  }

  for (const criterion of submitted) {
    if (criterion.label.trim() === "") {
      return { ok: false, message: "Every criterion needs a label. That is what a judge reads." };
    }
    if (!Number.isInteger(criterion.maxPoints) || criterion.maxPoints <= 0) {
      return {
        ok: false,
        message: `"${criterion.label}" needs a maximum above zero. A criterion worth nothing is one a judge fills in for no reason.`,
      };
    }
    if (!Number.isInteger(criterion.weightBp) || criterion.weightBp < 0) {
      return {
        ok: false,
        message: `"${criterion.label}" needs a weight of zero or more, in basis points (${BASIS_POINTS} is 1×).`,
      };
    }
  }

  if (submitted.every((criterion) => criterion.weightBp === 0)) {
    return {
      ok: false,
      message:
        "Every criterion is weighted zero, so nothing would count toward a placement. Weight at least one above zero.",
    };
  }

  const byId = new Map(current.map((criterion) => [criterion.id, criterion]));
  const kept = new Set<string>();
  const plan: RubricPlan = { ok: true, insert: [], update: [], delete: [], unchanged: [] };

  for (const criterion of submitted) {
    if (criterion.id === undefined) {
      plan.insert.push(criterion);
      continue;
    }

    const existing = byId.get(criterion.id);
    // An id the current rubric does not hold is a stale form, not an edit. Refused rather than
    // inserted, because inserting it would silently give a board a criterion it did not add.
    if (!existing) {
      return {
        ok: false,
        message: "That rubric changed while you were editing it. Reload and try again.",
      };
    }
    kept.add(criterion.id);

    const rescaled =
      existing.maxPoints !== criterion.maxPoints || existing.weightBp !== criterion.weightBp;
    if (rescaled && existing.scoreCount > 0) {
      return {
        ok: false,
        message: `"${existing.label}" already has ${existing.scoreCount} score${existing.scoreCount === 1 ? "" : "s"} against it, so its maximum and weight are fixed. A 24 out of 30 is not a 24 out of 50. Rewording the label is still fine.`,
      };
    }

    const changed =
      rescaled ||
      existing.label !== criterion.label ||
      existing.sortOrder !== criterion.sortOrder;
    if (changed) plan.update.push({ ...criterion, id: criterion.id });
    else plan.unchanged.push(criterion.id);
  }

  for (const criterion of current) {
    if (kept.has(criterion.id)) continue;
    if (criterion.scoreCount > 0) {
      return {
        ok: false,
        message: `"${criterion.label}" already has ${criterion.scoreCount} score${criterion.scoreCount === 1 ? "" : "s"} against it and cannot be removed — deleting it would delete those scores too. Set its weight to zero instead, which stops it counting without destroying what a judge wrote.`,
      };
    }
    plan.delete.push(criterion.id);
  }

  return plan;
};
