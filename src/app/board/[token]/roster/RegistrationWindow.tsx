"use client";

import { useActionState } from "react";
import { cardClass, cx, eyebrowClass, pillClass } from "@/components/styles";
import type { CompStatus } from "@/db/schema";
import { COMP_STATUS_MEANING, nextCompStatuses } from "@/lib/comp/lifecycle";
import { setCompStatusAction } from "../actions";
import { IDLE } from "../state";

const TONE: Record<CompStatus, string> = {
  draft: "bg-hover text-subtle",
  open: "bg-primary-light text-primary",
  live: "bg-secondary-light text-secondary",
  complete: "bg-hover text-muted",
};

// Only the statuses `nextCompStatuses` can return are ever rendered, and `draft` is not one of them
// — the lifecycle runs forward. The entry exists to keep the map total, not because it is reachable.
const VERB: Record<CompStatus, string> = {
  draft: "Draft",
  open: "Open registration",
  live: "Close registration",
  complete: "Mark complete",
};

/**
 * The registration window, and the first instrument in the product for closing it.
 *
 * `comps.status` gates the public form, and until now only the seed script wrote it — so a board
 * that opened registration could close it only by reseeding, which reissues every token and kills
 * the links already handed out (ADR-0013). The public URL is shown beside the control because the
 * two facts belong together: this is the form, and this is whether it is taking applications.
 *
 * The buttons come from `nextCompStatuses`, the machine's own map, so there is no second list of
 * what may follow what — the same rule `DepositTable` follows for `allowedFrom`.
 */
export function RegistrationWindow({
  token,
  status,
  publicPath,
}: {
  token: string;
  status: CompStatus;
  publicPath: string;
}) {
  const [state, action, pending] = useActionState(setCompStatusAction, IDLE);
  const next = nextCompStatuses(status);

  return (
    <div className={cx(cardClass, "mb-6")} data-testid="registration-window" data-status={status}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className={eyebrowClass}>Registration window</p>
          <p className="mt-1.5 flex items-center gap-2">
            <span className={cx(pillClass, TONE[status])} data-testid="comp-status">
              {status}
            </span>
            <span className="text-caption text-muted">{COMP_STATUS_MEANING[status]}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {next.map((to) => (
            <form key={to} action={action}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="status" value={to} />
              <button
                type="submit"
                disabled={pending}
                data-testid={`comp-status-${to}`}
                className="rounded border border-border px-2 py-1 text-caption text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
              >
                {VERB[to]}
              </button>
            </form>
          ))}
          {next.length === 0 && (
            <span className="text-caption text-subtle">This comp is finished.</span>
          )}
        </div>
      </div>

      {status === "open" && (
        <p className="mt-3 text-caption text-muted">
          Teams apply at{" "}
          <a
            href={publicPath}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="public-form-link"
            className="text-primary underline underline-offset-2"
          >
            {publicPath}
          </a>
        </p>
      )}

      {state.message && (
        <p
          role="status"
          data-testid="comp-status-message"
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
