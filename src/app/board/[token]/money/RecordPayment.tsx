"use client";

import { useActionState, useState } from "react";
import { cardClass, cx, eyebrowClass, inputClass, primaryButtonClass } from "@/components/styles";
import { PAYMENT_RAILS } from "@/db/schema";
import { unallocatedCents } from "@/lib/money/balance";
import { formatCents, parseDollars } from "@/lib/money/format";
import { recordPaymentAction } from "../actions";
import { IDLE } from "../state";

/**
 * The roster, reduced to what recording a payment needs.
 *
 * `RosterTeamView` carries `contactEmail`, `customAnswers` and the whole application; none of it
 * belongs in a client bundle for a form about money, and a lean projection is a compile error rather
 * than a review when somebody widens it.
 */
export type PayableTeam = {
  id: string;
  name: string;
  bidCode: string;
  status: string;
  charges: { id: string; kind: string; amountCents: number; paidCents: number }[];
};

const railLabel = (rail: string) => (rail === "ach" ? "ACH" : rail);

/**
 * A8's entry path. Hand-entered on a rail we record and do not move — which is the whole reason the
 * ledger closes PRD §14's gap without Stripe, and why `card` in this dropdown is a *record* of how
 * money arrived rather than a request to move any.
 *
 * The unallocated readout updates as you type, so a lump that does not fully attach is visible
 * *before* submitting rather than discovered afterward. That is the NCSU $2,160 case, and leaving it
 * unattached is a legitimate answer: `recordPayment` accepts an empty allocation set.
 */
export function RecordPayment({ token, teams }: { token: string; teams: PayableTeam[] }) {
  const [state, formAction, pending] = useActionState(recordPaymentAction, IDLE);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [gross, setGross] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  const team = teams.find((row) => row.id === teamId);

  const grossCents = parseDollars(gross);
  const allocatedCents = (team?.charges ?? []).reduce((sum, charge) => {
    const entered = allocations[charge.id]?.trim();
    if (!entered) return sum;
    return sum + (parseDollars(entered) ?? 0);
  }, 0);
  // `unallocatedCents` rather than the subtraction, because that helper exists so this readout, the
  // ledger's refusal and the unattributed panel cannot become three definitions of "what is left" —
  // and this form is the one its own docstring names.
  const unattached =
    grossCents === null ? null : unallocatedCents({ grossCents, allocatedCents });

  return (
    <div className={cardClass}>
      <h2 className="text-card font-semibold text-heading">Record a payment</h2>
      <p className="mt-1 text-caption text-muted">
        What arrived, and what it was for. Money that settles nothing in particular is a credit, not
        an error — leave the boxes blank and attach it later.
      </p>

      <form
        action={formAction}
        data-testid="record-payment"
        className="mt-4"
        // Not a controlled reset: the action re-renders the server component with the new roster,
        // and clearing here would fight it. Only the local readout state is cleared.
        onSubmit={() => {
          setGross("");
          setAllocations({});
        }}
      >
        <input type="hidden" name="token" value={token} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={eyebrowClass}>Team</span>
            <select
              name="teamId"
              value={teamId}
              onChange={(event) => {
                setTeamId(event.target.value);
                setAllocations({});
              }}
              data-testid="payment-team"
              className={cx(inputClass, "mt-1")}
            >
              {teams.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} ({row.bidCode}) · {row.status}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={eyebrowClass}>Rail</span>
            <select
              name="rail"
              defaultValue="venmo"
              data-testid="payment-rail"
              className={cx(inputClass, "mt-1")}
            >
              {PAYMENT_RAILS.map((rail) => (
                <option key={rail} value={rail}>
                  {railLabel(rail)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={eyebrowClass}>Amount that arrived</span>
            <input
              name="gross"
              value={gross}
              onChange={(event) => setGross(event.target.value)}
              inputMode="decimal"
              placeholder="2160.00"
              data-testid="payment-gross"
              className={cx(inputClass, "mt-1")}
            />
          </label>

          <label className="block">
            <span className={eyebrowClass}>Processing fee</span>
            <input
              name="fee"
              inputMode="decimal"
              placeholder="0.00"
              data-testid="payment-fee"
              className={cx(inputClass, "mt-1")}
            />
            {/* The $100 deposit that landed as $97.01. Gross and fee are both entered because the
                bank shows both, and `net = gross - fee` is a CHECK rather than a generated column
                precisely so an import that disagrees is refused instead of quietly corrected. */}
            <span className="mt-1 block text-micro text-subtle">
              What the processor took, if any. The team is credited the full amount.
            </span>
          </label>
        </div>

        <label className="mt-3 block">
          <span className={eyebrowClass}>Reference</span>
          <input
            name="externalRef"
            placeholder="Venmo note, check number — optional"
            data-testid="payment-ref"
            className={cx(inputClass, "mt-1")}
          />
        </label>

        {/* Opt-out rather than automatic, and checked by default because a receipt nobody remembers
            to ask for is a receipt that never goes. The case for the box existing at all is a
            treasurer backfilling last season on a Sunday: thirty rows must not become thirty emails
            to captains who were never expecting one. */}
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            name="receipt"
            defaultChecked
            data-testid="payment-receipt"
            className="size-4 accent-primary"
          />
          <span className="text-caption text-muted">
            Email a receipt to the team&apos;s captain
          </span>
        </label>

        {team && team.charges.length > 0 ? (
          <fieldset className="mt-4 border-t border-border-soft pt-3">
            <legend className={cx(eyebrowClass, "pr-2")}>What it settles</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {team.charges.map((charge) => {
                const remaining = charge.amountCents - charge.paidCents;
                return (
                  <label key={charge.id} className="block">
                    <span className="text-caption text-muted">
                      {charge.kind.replace("_", " ")}
                    </span>
                    <span className="block text-micro text-subtle">
                      {formatCents(remaining)} left of {formatCents(charge.amountCents)}
                    </span>
                    <input
                      name={`allocation-${charge.id}`}
                      value={allocations[charge.id] ?? ""}
                      onChange={(event) =>
                        setAllocations((prev) => ({ ...prev, [charge.id]: event.target.value }))
                      }
                      inputMode="decimal"
                      placeholder="0.00"
                      data-testid={`payment-allocation-${charge.kind}`}
                      className={cx(inputClass, "mt-1")}
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <p className="mt-4 border-t border-border-soft pt-3 text-caption text-muted">
            This team has no open obligations — charges are generated when it is accepted. The
            payment is recorded as a credit and can be attached once it has them.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-4">
          <p
            data-testid="payment-unattached"
            data-unattached-cents={unattached ?? ""}
            className="text-caption text-muted"
          >
            {unattached === null
              ? "Enter an amount."
              : unattached === 0
                ? "Fully attached."
                : unattached > 0
                  ? `${formatCents(unattached)} will be left unattached.`
                  : `${formatCents(-unattached)} more than the payment.`}
          </p>
          <button
            type="submit"
            disabled={pending}
            data-testid="payment-submit"
            className={primaryButtonClass}
          >
            Record
          </button>
        </div>
      </form>

      {state.message && (
        <p
          role="status"
          data-testid="payment-message"
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
