"use client";

import { useActionState } from "react";
import { cx, primaryButtonClass } from "@/components/styles";
import { sendFeedbackAction } from "../actions";
import { IDLE } from "../state";

/**
 * ADJ·2, beside the per-team files it replaces.
 *
 * The download stays: a board that wants to read a file before it goes, or to forward one by hand
 * to somebody who is not the captain on record, still can. This is the version that does not
 * require doing that eight times.
 */
export function SendFeedback({ token, teams }: { token: string; teams: number }) {
  const [state, formAction, pending] = useActionState(sendFeedbackAction, IDLE);

  return (
    <div className="mt-4 print:hidden" data-testid="send-feedback">
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          disabled={pending}
          data-testid="send-feedback-submit"
          className={primaryButtonClass}
        >
          {pending ? "…" : `Email feedback to all ${teams} teams`}
        </button>
      </form>

      {state.message && (
        <p
          role="status"
          data-testid="send-feedback-message"
          className={cx(
            "mt-3 text-caption",
            state.status === "error" ? "text-danger" : "text-muted",
          )}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
