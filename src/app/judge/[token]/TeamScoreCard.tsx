"use client";

import { useActionState, useState } from "react";
import { cardClass, cx, eyebrowClass, pillClass, primaryButtonClass } from "@/components/styles";
import type { Criterion } from "@/lib/tabulation/types";
import { submitScores } from "./actions";
import { IDLE } from "./state";

type Props = {
  token: string;
  teamId: string;
  bidCode: string;
  performanceOrder: number | null;
  criteria: Criterion[];
  initialValues: Record<string, number>;
  locked: boolean;
  index: number;
};

export function TeamScoreCard({
  token,
  teamId,
  bidCode,
  performanceOrder,
  criteria,
  initialValues,
  locked,
  index,
}: Props) {
  const [state, formAction, pending] = useActionState(submitScores, IDLE);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(criteria.map((c) => [c.id, initialValues[c.id]?.toString() ?? ""])),
  );

  const total = criteria.reduce((sum, c) => sum + (Number(values[c.id]) || 0), 0);
  const maxTotal = criteria.reduce((sum, c) => sum + c.maxPoints, 0);
  const complete = criteria.every((c) => values[c.id] !== "");
  const alreadyScored = Object.keys(initialValues).length === criteria.length;
  const scored = alreadyScored || state.status === "saved";

  return (
    <form
      action={formAction}
      data-testid={`team-card-${bidCode}`}
      className={cx(cardClass, "animate-fade-in-up")}
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="teamId" value={teamId} />

      <div className="flex items-baseline justify-between">
        <div>
          <span className={eyebrowClass}>
            {performanceOrder !== null ? `Performance ${performanceOrder}` : "Team"}
          </span>
          <h2 className="tabular mt-0.5 text-title font-bold text-heading">{bidCode}</h2>
        </div>
        {scored && (
          <span className={cx(pillClass, "bg-primary-light text-primary")}>Scored</span>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {criteria.map((criterion) => (
          <label key={criterion.id} className="flex items-center justify-between gap-4">
            <span className="text-body font-medium text-heading">
              {criterion.label}
              <span className="ml-1.5 text-caption font-normal text-subtle">
                / {criterion.maxPoints}
              </span>
            </span>
            <input
              name={`criterion:${criterion.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={criterion.maxPoints}
              step={1}
              required
              disabled={locked}
              value={values[criterion.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [criterion.id]: e.target.value }))}
              aria-label={criterion.label}
              className="tabular w-20 rounded-md border border-border bg-surface px-3 py-2 text-right text-lg font-semibold text-heading focus:border-primary focus:outline-none disabled:bg-app disabled:text-subtle"
            />
          </label>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-border-soft pt-4">
        <span className="tabular text-body text-muted">
          <span className="font-semibold text-heading">{total}</span> / {maxTotal}
        </span>
        <button
          type="submit"
          disabled={locked || pending || !complete}
          className={primaryButtonClass}
        >
          {pending ? "Saving…" : alreadyScored ? "Update" : "Submit"}
        </button>
      </div>

      {state.status === "error" && (
        <p role="alert" className="mt-3 text-body text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}
