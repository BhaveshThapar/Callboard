"use client";

import { useActionState } from "react";
import { cardClass, cx, eyebrowClass, inputClass, primaryButtonClass } from "@/components/styles";
import { sendAnnouncementAction } from "../actions";
import { IDLE } from "../state";

/**
 * The board's own voice, and the first thing in this product that speaks to everybody at once.
 *
 * It sits on the roster rather than beside the money, because the audience is the roster: every team
 * that is accepted or competing. A dropped team is not told where to park, and a waitlisted one has
 * not been told it is coming — `ANNOUNCEABLE_STATUSES` is that rule, and it is deliberately its own
 * list rather than an alias of the two beside it.
 */
export function Announce({ token, audience }: { token: string; audience: number }) {
  const [state, formAction, pending] = useActionState(sendAnnouncementAction, IDLE);

  return (
    <div className={cardClass} data-testid="announce">
      <h2 className="text-card font-semibold text-heading">Tell every team</h2>
      <p className="mt-1 text-caption text-muted">
        Goes to the {audience} team{audience === 1 ? "" : "s"} that are in — not the waitlist, and
        not anyone who dropped. Signed by you. Anyone who has unsubscribed will not receive it, and
        you will be told how many that was.
      </p>

      <form action={formAction} className="mt-4">
        <input type="hidden" name="token" value={token} />

        <input
          name="subject"
          placeholder="Subject — e.g. Load-in moved to 7:30"
          aria-label="Subject"
          data-testid="announce-subject"
          className={inputClass}
        />
        <textarea
          name="body"
          rows={4}
          placeholder="What you need them to know."
          aria-label="Message"
          data-testid="announce-body"
          className={cx(inputClass, "mt-2 resize-y")}
        />

        <button
          type="submit"
          disabled={pending || audience === 0}
          data-testid="announce-submit"
          className={cx(primaryButtonClass, "mt-3")}
        >
          {pending ? "…" : "Send to every team"}
        </button>
      </form>

      {state.message && (
        <p
          role="status"
          data-testid="announce-message"
          className={cx(
            "mt-3 text-caption",
            state.status === "error" ? "text-danger" : "text-muted",
          )}
        >
          {state.message}
        </p>
      )}

      <p className={cx(eyebrowClass, "mt-3")}>
        The same message is never sent to a team twice
      </p>
    </div>
  );
}
