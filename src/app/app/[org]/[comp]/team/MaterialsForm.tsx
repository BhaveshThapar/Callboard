"use client";

import { useActionState } from "react";
import { cardClass, cx, eyebrowClass } from "@/components/styles";
import { submitMaterialsAction } from "../actions";
import { IDLE } from "../state";

const inputClass =
  "w-full rounded border border-border bg-transparent px-2 py-1.5 text-body text-heading focus:border-primary focus:outline-none";

const labelClass = "block text-caption text-muted";

/**
 * A4's materials half, from the captain's side.
 *
 * It carries **no `teamId`**, and there is nothing on it that names a team at all -- the comp is in
 * the path and the team comes off the actor's membership, which is the property that let
 * `ownTeamForCaptain` be a fourth window and is the reason this form needs no claim check.
 *
 * `org` and `comp` are here rather than a `compId` because a Server Action gets no route params, and
 * because they are the same two slugs already in the address bar. They address; they do not
 * authorize. `BoardFormScope`'s `compId` would be the wrong shape here: it is the board's
 * authorization subject, and a captain's authority is their session.
 *
 * The dancer count is presented as a **request**, in those words, because that is what it is -- the
 * board states the roster and the board's statement is what bills. A field that looked like it
 * changed the number would be a captain editing their own invoice.
 */
export function MaterialsForm({
  org,
  comp,
  locked,
  filed,
}: {
  org: string;
  comp: string;
  locked: boolean;
  filed: {
    musicUrl: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    rosterSizeRequested: number | null;
    materialsSubmittedAt: Date | null;
  };
}) {
  const [state, action, pending] = useActionState(submitMaterialsAction, IDLE);

  return (
    <form action={action} className={cx(cardClass, "mt-6")} data-testid="materials-form">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="comp" value={comp} />

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className={eyebrowClass}>Your materials</p>
          <p className="mt-1.5 text-caption text-muted">
            What your board needs from you after acceptance.
          </p>
        </div>
        {filed.materialsSubmittedAt && (
          <span className="text-caption text-subtle" data-testid="materials-filed-at">
            Last filed {filed.materialsSubmittedAt.toISOString().slice(0, 10)}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-4">
        <div>
          <label className={labelClass} htmlFor="musicUrl">
            Final music — a link
          </label>
          <input
            id="musicUrl"
            name="musicUrl"
            type="url"
            inputMode="url"
            defaultValue={filed.musicUrl ?? ""}
            placeholder="https://drive.google.com/..."
            data-testid="materials-music"
            className={cx(inputClass, "mt-1")}
          />
          <p className="mt-1 text-caption text-subtle">
            Share it with your board first — Callboard stores the link, not the file.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="emergencyContactName">
              Emergency contact
            </label>
            <input
              id="emergencyContactName"
              name="emergencyContactName"
              defaultValue={filed.emergencyContactName ?? ""}
              data-testid="materials-contact-name"
              className={cx(inputClass, "mt-1")}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="emergencyContactPhone">
              Their number
            </label>
            <input
              id="emergencyContactPhone"
              name="emergencyContactPhone"
              type="tel"
              defaultValue={filed.emergencyContactPhone ?? ""}
              data-testid="materials-contact-phone"
              className={cx(inputClass, "mt-1")}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="rosterSizeRequested">
            Dancers, if this has changed
          </label>
          <input
            id="rosterSizeRequested"
            name="rosterSizeRequested"
            inputMode="numeric"
            disabled={locked}
            defaultValue={filed.rosterSizeRequested ?? ""}
            data-testid="materials-dancers"
            className={cx(inputClass, "mt-1 max-w-28 tabular", locked && "opacity-40")}
          />
          <p className="mt-1 text-caption text-subtle" data-testid="materials-dancers-note">
            {locked
              ? "Results are locked, so the roster can no longer change."
              : "A request, not a change. Your board confirms it, and only then does what you owe move."}
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          data-testid="materials-submit"
          className="rounded bg-primary px-3 py-1.5 text-caption font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Filing…" : "File these"}
        </button>
        {state.message && (
          <p
            role="status"
            data-testid="materials-message"
            className={cx(
              "text-caption",
              state.status === "error" ? "text-danger" : "text-muted",
            )}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
