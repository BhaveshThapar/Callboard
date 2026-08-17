"use client";

import { useActionState } from "react";
import { cardClass, cx, pillClass, primaryButtonClass } from "@/components/styles";
import type { DutyConfig } from "@/db/schema";
import type { DutyView } from "@/lib/auth/scope";
import { labelFor, resolveDuty } from "@/lib/coord/duties";
import { acknowledgeDutyAction, completeDutyAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import { IDLE } from "../state";

const when = (at: Date | null): string =>
  at
    ? new Date(at).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Time not set yet";

/**
 * A liaison's own duties, and the only two writes a liaison makes in this product.
 *
 * Both buttons post an `assignmentId` that resolves against `listDutiesForLiaison` — rows that are
 * already only this person's — so a hand-crafted POST naming somebody else's duty finds nothing.
 * And both are one guarded `UPDATE` server-side, so a second click on a slow phone is told it is
 * already recorded rather than moving the timestamp.
 */
export function MyDuties({
  compId,
  basePath,
  duties,
  mine,
}: {
  compId: string;
  basePath: string;
  duties: DutyConfig[];
  mine: DutyView[];
}) {
  const scope = { compId, basePath };
  const [ackState, acknowledge] = useActionState(acknowledgeDutyAction, IDLE);
  const [doneState, complete] = useActionState(completeDutyAction, IDLE);
  const state = ackState.status !== "idle" ? ackState : doneState;

  return (
    <div className="space-y-4" data-testid="my-duties">
      {mine.map((duty) => {
        const config = resolveDuty(duties, duty.dutyId);
        return (
          <div key={duty.id} className={cardClass} data-duty={duty.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-body font-semibold text-heading">
                  {labelFor(duties, duty.dutyId)}
                </h3>
                {duty.teamName && (
                  <p className="text-caption text-subtle mt-1" data-testid="duty-team">
                    {duty.teamName}
                  </p>
                )}
                <p className="text-caption text-subtle mt-1">
                  {when(duty.startsAt)}
                  {duty.endsAt ? ` – ${when(duty.endsAt)}` : ""}
                </p>
              </div>

              {duty.completedAt ? (
                <span className={pillClass} data-testid="duty-state">
                  Done
                </span>
              ) : duty.acknowledgedAt ? (
                <span className={pillClass} data-testid="duty-state">
                  Acknowledged
                </span>
              ) : null}
            </div>

            {config?.help && <p className="text-caption text-subtle mt-3">{config.help}</p>}
            {duty.note && <p className="text-body mt-3">{duty.note}</p>}

            {/* Stated whether or not it is done, because a liaison who has not been trained needs to
                know before comp day rather than at the door. */}
            {config?.swaRequired && (
              <p className="text-caption text-subtle mt-3" data-testid="duty-swa">
                {duty.swaTrainedAt
                  ? "SWA training recorded."
                  : "This duty needs SWA training. The board has not recorded yours yet."}
              </p>
            )}

            <div className="mt-4 flex gap-3">
              {!duty.acknowledgedAt && (
                <form action={acknowledge}>
                  <ScopeFields scope={scope} />
                  <input type="hidden" name="assignmentId" value={duty.id} />
                  <button type="submit" className={primaryButtonClass} data-testid="acknowledge">
                    Got it
                  </button>
                </form>
              )}
              {!duty.completedAt && (
                <form action={complete}>
                  <ScopeFields scope={scope} />
                  <input type="hidden" name="assignmentId" value={duty.id} />
                  <button type="submit" className="text-caption underline" data-testid="complete">
                    Mark done
                  </button>
                </form>
              )}
            </div>
          </div>
        );
      })}

      {state.status !== "idle" && (
        <p
          className={cx(
            "text-caption",
            state.status === "error" ? "text-danger" : "text-subtle",
          )}
          data-testid="duty-result"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
