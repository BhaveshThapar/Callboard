"use client";

import { useActionState } from "react";
import {
  cardClass,
  cx,
  eyebrowClass,
  inputClass,
  pillClass,
  primaryButtonClass,
} from "@/components/styles";
import { connectStripeAction, refreshStripeAction, setStripeRatesAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import type { BoardFormScope } from "../state";
import { IDLE } from "../state";

/**
 * A5 — the comp connects its **own** Stripe account.
 *
 * The sentence on this card is the product decision, not marketing: funds settle directly to the
 * org, which owns its dashboard, its payouts and its 1099 ([ADR-0005](../../../../../docs/decisions/0005-stripe-connect-standard-never-hold-funds.md)).
 * Callboard orchestrates and reconciles and never sits in the flow of funds — and for a student
 * vendor, *"what happens to our money if you disappear?"* answering *"nothing, it was never ours"*
 * is worth more than a slicker onboarding.
 *
 * **Two states, never conflated.** A board can finish Stripe's form and still not be able to take
 * money while it verifies. A screen that showed one boolean would tell a treasurer they were ready
 * and then fail their first payment.
 */
export function StripeConnect({
  scope,
  configured,
  view,
}: {
  scope: BoardFormScope;
  configured: boolean;
  view: {
    accountId: string | null;
    chargesEnabled: boolean;
    detailsSubmitted: boolean;
    nonprofitRate: boolean;
    surchargeBp: number;
  };
}) {
  const [connectState, connect, connecting] = useActionState(connectStripeAction, IDLE);
  const [refreshState, refresh, refreshing] = useActionState(refreshStripeAction, IDLE);
  const [rateState, saveRates, savingRates] = useActionState(setStripeRatesAction, IDLE);

  if (!configured) {
    return (
      <section className={cx(cardClass, "mt-6")} data-testid="stripe">
        <h3 className={eyebrowClass}>Card and bank payments</h3>
        <p className="mt-3 text-body text-muted" data-testid="stripe-unconfigured">
          Not configured on this deployment — `STRIPE_SECRET_KEY` is unset, so no account can be
          connected. Every other way of taking money still works: the ledger records Venmo, Zelle,
          cheques and cash the same way, and closing the reconciliation gap never needed a card rail.
        </p>
      </section>
    );
  }

  return (
    <section className={cx(cardClass, "mt-6")} data-testid="stripe">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={eyebrowClass}>Card and bank payments</h3>
        {view.accountId && (
          <span
            className={cx(pillClass, !view.chargesEnabled && "text-danger")}
            data-testid="stripe-state"
          >
            {view.chargesEnabled
              ? "Ready to take payments"
              : view.detailsSubmitted
                ? "Stripe is verifying"
                : "Needs your details"}
          </span>
        )}
      </div>

      <p className="mt-2 text-caption text-subtle">
        Your org connects its own Stripe account. Money settles <strong>directly to you</strong> —
        you own the dashboard, the payouts and the 1099. Callboard records what arrived and never
        holds a cent of it.
      </p>

      {!view.accountId ? (
        <form action={connect} className="mt-4">
          <ScopeFields scope={scope} />
          <button
            type="submit"
            disabled={connecting}
            className={primaryButtonClass}
            data-testid="stripe-connect"
          >
            Connect a Stripe account
          </button>
        </form>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={connect}>
              <ScopeFields scope={scope} />
              <button
                type="submit"
                disabled={connecting}
                className="rounded-md border border-border px-3 py-1.5 text-caption text-muted hover:text-heading"
                data-testid="stripe-continue"
              >
                {view.detailsSubmitted ? "Update details at Stripe" : "Finish setup at Stripe"}
              </button>
            </form>
            <form action={refresh}>
              <ScopeFields scope={scope} />
              <button
                type="submit"
                disabled={refreshing}
                className="rounded-md border border-border px-3 py-1.5 text-caption text-muted hover:text-heading"
                data-testid="stripe-refresh"
              >
                Check with Stripe
              </button>
            </form>
          </div>

          <form action={saveRates} className="mt-5 flex flex-wrap items-end gap-3">
            <ScopeFields scope={scope} />
            <label className="flex items-center gap-2 text-caption text-subtle">
              <input
                type="checkbox"
                name="nonprofitRate"
                defaultChecked={view.nonprofitRate}
                data-testid="stripe-nonprofit"
              />
              Stripe has verified us as a nonprofit (2.2% + 30¢ instead of 2.9% + 30¢)
            </label>
            <label className="text-caption text-subtle">
              Pass to the payer (%)
              <input
                type="number"
                name="surchargePercent"
                min={0}
                max={3}
                step={0.1}
                defaultValue={(view.surchargeBp / 100).toFixed(1)}
                className={cx(inputClass, "mt-1 w-24")}
                data-testid="stripe-surcharge"
              />
            </label>
            <button
              type="submit"
              disabled={savingRates}
              className={primaryButtonClass}
              data-testid="stripe-save-rates"
            >
              Save
            </button>
          </form>

          <p className="mt-2 text-caption text-subtle">
            Bank transfers cost 0.8% capped at $5, so a $2,160 payment costs five dollars rather than
            sixty-three. Cards stay available for small and last-minute payments. A surcharge is
            disclosed to the payer as its own line and cannot exceed 3% — above that breaks US
            card-network rules, and the rule lands on your org rather than on us.
          </p>
        </>
      )}

      {[connectState, refreshState, rateState].map((state, i) =>
        state.message ? (
          <p
            key={i}
            className={cx(
              "mt-3 text-caption break-all",
              state.status === "error" ? "text-danger" : "text-subtle",
            )}
            data-testid="stripe-message"
          >
            {state.status === "ok" && state.message.startsWith("http") ? (
              <a href={state.message} className="text-primary underline underline-offset-2">
                Continue to Stripe →
              </a>
            ) : (
              state.message
            )}
          </p>
        ) : null,
      )}
    </section>
  );
}
