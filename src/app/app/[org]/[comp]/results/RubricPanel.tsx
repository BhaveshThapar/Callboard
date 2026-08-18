"use client";

import { useActionState, useState } from "react";
import {
  cardClass,
  cx,
  eyebrowClass,
  inputClass,
  pillClass,
  primaryButtonClass,
} from "@/components/styles";
import { NORMALIZATIONS } from "@/lib/tabulation/types";
import type { NormalizationMethod } from "@/lib/tabulation/types";
import { setRubricAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import type { BoardFormScope } from "../state";
import { IDLE } from "../state";

export type CriterionRow = {
  id: string;
  label: string;
  maxPoints: number;
  weightBp: number;
  scoreCount: number;
};

const NORMALIZATION_LABEL: Record<NormalizationMethod, string> = {
  raw: "Raw mean — judges' totals, unadjusted",
  zscore: "Z-score — each judge normalized against their own spread",
  rank: "Rank — each judge's ordering, not their numbers",
};

/**
 * P2's rubric builder, and the last of that row's three parts to exist.
 *
 * It lives on the Results screen rather than a seventh nav tab, for the reason C1 refused to split
 * comp day: six tabs is what fits on a Pixel 7. It belongs here on its own terms too — the rubric is
 * the thing results are computed *from*, and this is where a board already comes to look at them.
 *
 * **A criterion with scores against it is shown locked, not hidden.** The refusals live in
 * `planRubric` and the server enforces them regardless of this markup; what the screen adds is
 * saying *why* before somebody tries. `scores.criterion_id` cascades on delete, so the alternative
 * to an explanation is a board removing a criterion and taking a judge's evening with it.
 */
export function RubricPanel({
  scope,
  rubric,
}: {
  scope: BoardFormScope;
  rubric: {
    name: string;
    normalization: NormalizationMethod;
    criteria: CriterionRow[];
    locked: boolean;
  };
}) {
  const [state, submit, pending] = useActionState(setRubricAction, IDLE);
  const [rows, setRows] = useState<CriterionRow[]>(rubric.criteria);

  const addRow = () =>
    setRows((current) => [
      ...current,
      { id: "", label: "", maxPoints: 10, weightBp: 10_000, scoreCount: 0 },
    ]);

  const removeRow = (index: number) =>
    setRows((current) => current.filter((_, i) => i !== index));

  if (rubric.locked) {
    return (
      <section className={cx(cardClass, "mt-6")} data-testid="rubric">
        <h3 className={eyebrowClass}>Rubric</h3>
        <p className="mt-2 text-body text-muted" data-testid="rubric-locked">
          Results are locked, so the rubric can no longer change. The locked run reproduces from its
          own frozen copy of it, so an edit here would change nothing anybody can see.
        </p>
        <ul className="mt-4 space-y-1">
          {rubric.criteria.map((row) => (
            <li key={row.id} className="text-caption text-subtle">
              {row.label} — max {row.maxPoints}, weight {(row.weightBp / 10_000).toFixed(2)}×
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className={cx(cardClass, "mt-6")} data-testid="rubric">
      <h3 className={eyebrowClass}>Rubric</h3>
      <p className="mt-2 text-caption text-subtle">
        What judges score, and how their numbers combine. Weights are a multiplier — 1.00× counts
        once. A criterion weighted 0 is asked and does not count, which is how one is retired without
        destroying what a judge already wrote.
      </p>

      <form action={submit} className="mt-4">
        <ScopeFields scope={scope} />

        <label className="block text-caption text-subtle">
          Name
          <input
            name="rubricName"
            defaultValue={rubric.name}
            required
            className={cx(inputClass, "mt-1 w-full")}
            data-testid="rubric-name"
          />
        </label>

        <label className="mt-3 block text-caption text-subtle">
          Normalization
          <select
            name="normalization"
            defaultValue={rubric.normalization}
            className={cx(inputClass, "mt-1 w-full")}
            data-testid="rubric-normalization"
          >
            {NORMALIZATIONS.map((method) => (
              <option key={method} value={method}>
                {NORMALIZATION_LABEL[method]}
              </option>
            ))}
          </select>
        </label>

        <ol className="mt-4 space-y-2" data-testid="rubric-criteria">
          {rows.map((row, i) => (
            <li key={row.id || `new-${i}`} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="criterionId" value={row.id} />
              <label className="flex-1 text-caption text-subtle">
                Criterion
                <input
                  name="criterionLabel"
                  defaultValue={row.label}
                  required
                  className={cx(inputClass, "mt-1 w-full")}
                  data-testid={`rubric-label-${i}`}
                />
              </label>
              <label className="text-caption text-subtle">
                Max
                <input
                  name="criterionMax"
                  type="number"
                  min={1}
                  defaultValue={row.maxPoints}
                  required
                  readOnly={row.scoreCount > 0}
                  className={cx(inputClass, "mt-1 w-20", row.scoreCount > 0 && "opacity-60")}
                  data-testid={`rubric-max-${i}`}
                />
              </label>
              <label className="text-caption text-subtle">
                Weight ×10000
                <input
                  name="criterionWeight"
                  type="number"
                  min={0}
                  defaultValue={row.weightBp}
                  required
                  className={cx(inputClass, "mt-1 w-28")}
                  data-testid={`rubric-weight-${i}`}
                />
              </label>
              {row.scoreCount > 0 ? (
                <span className={pillClass} data-testid={`rubric-scored-${i}`}>
                  {row.scoreCount} scored — fixed
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="rounded-md border border-border px-2 py-1 text-caption text-muted hover:text-danger"
                  data-testid={`rubric-remove-${i}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={addRow}
            className="rounded-md border border-border px-3 py-1.5 text-caption text-muted hover:text-heading"
            data-testid="rubric-add"
          >
            Add criterion
          </button>
          <button
            type="submit"
            disabled={pending}
            className={primaryButtonClass}
            data-testid="rubric-save"
          >
            Save rubric
          </button>
        </div>
      </form>

      {state.message && (
        <p
          className={cx(
            "mt-3 text-caption",
            state.status === "error" ? "text-danger" : "text-subtle",
          )}
          data-testid="rubric-message"
        >
          {state.message}
        </p>
      )}
    </section>
  );
}
