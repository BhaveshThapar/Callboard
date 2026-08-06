"use client";

import { useActionState } from "react";
import { cx } from "@/components/styles";
import { regenerateChargesAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import type { BoardFormScope } from "../state";
import { IDLE } from "../state";

/**
 * A6's missing hand. `syncCharges` had two callers and both were inside `setTeamStatus`, so a status
 * transition was the only thing in the product that re-ran the fee schedule — and a late fee, whose
 * whole definition is *the date passed*, has no status transition behind it. A comp that accepted
 * its teams in December and set `lateAfter` to February billed nobody, and the who-owes screen could
 * not say so: it recomputes gaps and reads owed from live charges, so an ungenerated charge is not a
 * gap, it is an absence.
 *
 * Safe to click twice, and that is a property of `planCharges` rather than of this button: identity
 * is `(teamId, kind)` among live charges, so a run with nothing changed plans nothing.
 */
export function RegenerateCharges({ scope }: { scope: BoardFormScope }) {
  const [state, action, pending] = useActionState(regenerateChargesAction, IDLE);

  return (
    <div className="flex items-center gap-3">
      <form action={action}>
        <ScopeFields scope={scope} />
        <button
          type="submit"
          disabled={pending}
          data-testid="regenerate-charges"
          className="rounded border border-border px-2 py-1 text-caption text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
        >
          {pending ? "Regenerating…" : "Regenerate charges"}
        </button>
      </form>
      {state.message && (
        <p
          role="status"
          data-testid="regenerate-message"
          className={cx(
            "text-caption",
            state.status === "error" ? "text-danger" : "text-muted",
          )}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
