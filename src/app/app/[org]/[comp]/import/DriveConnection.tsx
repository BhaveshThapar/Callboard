"use client";

import { useActionState } from "react";
import { cx } from "@/components/styles";
import { disconnectDriveAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import { IDLE } from "../state";

/**
 * The end of ADR-0011's rule applied to the one credential this product holds *outward*.
 *
 * Every other credential here is one the product issues and can revoke. This one is a grant somebody
 * gave *us*, and a board must still be able to end it. `revokeConnection` existed with no button for
 * as long as it took an audit to notice, which is this repo's most-recorded defect appearing in the
 * feature that reads its own history.
 *
 * It says plainly that it does not reach into Google, because implying otherwise would be a promise
 * this product cannot keep.
 */
export function DriveConnection({
  compId,
  basePath,
  email,
  connectedAt,
  reconnectHref,
}: {
  compId: string;
  basePath: string;
  email: string;
  connectedAt: string;
  reconnectHref: string;
}) {
  const [state, action, pending] = useActionState(disconnectDriveAction, IDLE);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-body text-heading" data-testid="drive-account">
            {email}
          </p>
          <p className="mt-1 text-caption text-subtle">Connected {connectedAt} · read-only</p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={reconnectHref}
            data-testid="drive-reconnect"
            className="rounded border border-border px-2 py-1 text-caption text-muted hover:border-primary hover:text-primary"
          >
            Use a different account
          </a>
          <form action={action}>
            <ScopeFields scope={{ compId, basePath }} />
            <button
              type="submit"
              disabled={pending}
              data-testid="drive-disconnect"
              className="rounded border border-border px-2 py-1 text-caption text-muted hover:border-danger hover:text-danger disabled:opacity-40"
            >
              {pending ? "Disconnecting…" : "Disconnect"}
            </button>
          </form>
        </div>
      </div>

      {state.message && (
        <p
          role="status"
          data-testid="drive-connection-message"
          className={cx("mt-3 text-caption", state.status === "error" ? "text-danger" : "text-muted")}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
