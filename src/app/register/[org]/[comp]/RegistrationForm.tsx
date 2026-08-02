"use client";

import { useActionState } from "react";
import { CheckCircleIcon } from "@/components/icons";
import { cardClass, cx, inputClass, primaryButtonClass } from "@/components/styles";
import type { OpenRegistration } from "@/lib/comp/registration";
import { applyAction } from "./actions";
import { CustomFields } from "./CustomFields";
import { EMPTY, IDLE } from "./state";

const labelClass = "text-body font-medium text-heading";
const hintClass = "mt-0.5 text-caption text-muted";

export function RegistrationForm({
  open,
  orgSlug,
  compSlug,
}: {
  open: OpenRegistration;
  orgSlug: string;
  compSlug: string;
}) {
  const [state, formAction, pending] = useActionState(applyAction, IDLE);

  if (state.status === "applied") {
    return (
      <div className={cx(cardClass, "flex gap-3")} role="status" data-testid="applied">
        <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="text-card font-semibold text-heading">Application received.</p>
          <p className="mt-1 text-body text-muted">
            Your team is <strong className="font-semibold text-heading">{state.bidCode}</strong>.
            The board reviews applications and will be in touch — you are not accepted yet.
          </p>
        </div>
      </div>
    );
  }

  // React resets an uncontrolled form once its action has run, so a refusal would otherwise hand
  // the applicant an error and a blank form. The values come back with the error and go straight
  // back in.
  const was = state.status === "error" ? state.values : EMPTY;

  return (
    <form action={formAction} className={cardClass} data-testid="registration-form">
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="comp" value={compSlug} />

      <div className="space-y-4">
        <div>
          <label htmlFor="teamName" className={labelClass}>
            Team name
          </label>
          <input
            id="teamName"
            name="teamName"
            required
            defaultValue={was.teamName}
            className={cx(inputClass, "mt-2")}
          />
        </div>

        <div>
          <label htmlFor="school" className={labelClass}>
            School
          </label>
          <input
            id="school"
            name="school"
            defaultValue={was.school}
            className={cx(inputClass, "mt-2")}
          />
        </div>

        <div>
          <label htmlFor="rosterSize" className={labelClass}>
            Roster size
          </label>
          <p className={hintClass}>
            How many dancers you expect to bring
            {open.form.maxRosterSize ? `. This comp caps it at ${open.form.maxRosterSize}.` : "."}
          </p>
          <input
            id="rosterSize"
            name="rosterSize"
            type="number"
            min={1}
            max={open.form.maxRosterSize}
            step={1}
            required
            defaultValue={was.rosterSize}
            className={cx(inputClass, "tabular mt-2")}
          />
        </div>

        {open.collectRooms && (
          <div>
            <label htmlFor="rooms" className={labelClass}>
              Hotel rooms
            </label>
            <p className={hintClass}>
              This comp bills per room. Leave it blank if you do not know yet — the board can fill it
              in later, and nothing is charged for rooms until it is known.
            </p>
            <input
              id="rooms"
              name="rooms"
              type="number"
              min={0}
              step={1}
              defaultValue={was.rooms}
              className={cx(inputClass, "tabular mt-2")}
            />
          </div>
        )}

        <div>
          <label htmlFor="contactName" className={labelClass}>
            Contact name
          </label>
          <p className={hintClass}>One person the board can reach. Usually the captain.</p>
          <input
            id="contactName"
            name="contactName"
            required
            defaultValue={was.contactName}
            className={cx(inputClass, "mt-2")}
          />
        </div>

        <div>
          <label htmlFor="contactEmail" className={labelClass}>
            Contact email
          </label>
          <input
            id="contactEmail"
            name="contactEmail"
            type="email"
            required
            defaultValue={was.contactEmail}
            className={cx(inputClass, "mt-2")}
          />
        </div>

        <div>
          <label htmlFor="auditionUrl" className={labelClass}>
            Audition video link
            {!open.form.requireAuditionUrl && (
              <span className="ml-1.5 font-normal text-subtle">optional</span>
            )}
          </label>
          <input
            id="auditionUrl"
            name="auditionUrl"
            type="url"
            required={open.form.requireAuditionUrl}
            placeholder="https://"
            defaultValue={was.auditionUrl}
            className={cx(inputClass, "mt-2")}
          />
        </div>

        {/* The comp's own questions sit after everything the product asks and before the waiver,
            which stays last: it is the acknowledgment of the whole form above it. */}
        {open.form.fields && open.form.fields.length > 0 && (
          <div className="space-y-4 border-t border-border-soft pt-4" data-testid="custom-fields">
            <CustomFields fields={open.form.fields} was={was.custom} />
          </div>
        )}

        <div className="border-t border-border-soft pt-4">
          <p className="text-caption whitespace-pre-line text-muted">{open.form.waiverText}</p>
          <label className="mt-3 flex items-start gap-2.5 text-body text-heading">
            <input
              type="checkbox"
              name="waiver"
              required
              defaultChecked={was.waiverAccepted}
              aria-label="Accept the waiver"
              className="mt-1 size-4 shrink-0"
            />
            <span>I have read and accept the waiver above.</span>
          </label>
        </div>
      </div>

      <button type="submit" disabled={pending} className={cx(primaryButtonClass, "mt-5 w-full")}>
        {pending ? "Submitting…" : "Apply"}
      </button>

      {state.status === "error" && (
        <p role="alert" data-testid="apply-error" className="mt-3 text-caption text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}
