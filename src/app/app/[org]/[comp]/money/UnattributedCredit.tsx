"use client";

import { useActionState, useState } from "react";
import { cardClass, cx, eyebrowClass, inputClass, primaryButtonClass } from "@/components/styles";
import { formatCents } from "@/lib/money/format";
import { allocatePaymentAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import type { BoardFormScope } from "../state";
import { IDLE } from "../state";

export type OpenPaymentView = {
  id: string;
  teamName: string;
  bidCode: string;
  rail: string;
  receivedAt: string;
  grossCents: number;
  remainingCents: number;
  /** This payment's team's live charges — where its remainder is allowed to go. */
  charges: { id: string; kind: string; amountCents: number; paidCents: number }[];
};

/**
 * The recovery instrument, and the reason a lump is not a dead end.
 *
 * A payment's allocations used to be fixed at insert, so money that arrived before its obligations
 * existed — a deposit paid to hold a slot, NCSU's $2,160 covering three things — could be recorded
 * and never attributed. The balance was right the whole time, because `paid` is gross-based; what
 * was wrong was every answer to *which* obligation the money settled, which is the question A7's
 * refund chain is built on top of.
 *
 * Applying money here must not move a balance. That is the assertion worth the most in the e2e.
 */
export function UnattributedCredit({
  scope,
  payments,
  totalRemainingCents,
}: {
  scope: BoardFormScope;
  payments: OpenPaymentView[];
  totalRemainingCents: number;
}) {
  const [state, formAction, pending] = useActionState(allocatePaymentAction, IDLE);
  /**
   * `undefined` means "nobody has chosen yet", which is not the same as "collapsed". Initializing
   * the state to `payments[0]` instead would freeze whatever the list held at mount — and at mount
   * it is usually empty, because the first unattributed payment appears *after* one is recorded on
   * this same screen. The panel would then arrive collapsed here and expanded on a fresh load.
   */
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const open = chosen === undefined ? payments[0]?.id : chosen;

  /**
   * Attaching the *last* of a payment's credit empties this list, and returning `null` on an empty
   * list would unmount the confirmation along with it — you finish the job and the screen goes
   * blank. So an empty list still renders once there is something to say.
   */
  if (payments.length === 0) {
    if (!state.message) return null;
    return (
      <div className={cardClass} data-testid="unattributed">
        <h2 className="text-card font-semibold text-heading">
          Everything that arrived is attached
        </h2>
        <p role="status" data-testid="apply-message" className="mt-1 text-caption text-muted">
          {state.message}
        </p>
      </div>
    );
  }

  return (
    <div className={cardClass} data-testid="unattributed">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-card font-semibold text-heading">
          <span data-testid="unattributed-total">{formatCents(totalRemainingCents)}</span> arrived
          and is not attached to anything
        </h2>
        <p className="text-caption text-muted">
          {payments.length} payment{payments.length === 1 ? "" : "s"}
        </p>
      </div>
      <p className="mt-1 text-caption text-muted">
        The money is counted — every cent that arrived is in the balance already. What is missing is
        what it was for.
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {payments.map((payment) => (
          <li
            key={payment.id}
            data-testid={`open-payment-${payment.bidCode}`}
            data-remaining-cents={payment.remainingCents}
            className="rounded-md border border-border-soft p-3"
          >
            <button
              type="button"
              onClick={() => setChosen(open === payment.id ? null : payment.id)}
              className="flex w-full items-baseline justify-between gap-4 text-left"
            >
              <span>
                <span className="font-medium text-heading">{payment.teamName}</span>
                <span className="ml-1.5 text-caption text-subtle">{payment.bidCode}</span>
                <span className="block text-caption text-subtle">
                  {formatCents(payment.grossCents)} by {payment.rail} on {payment.receivedAt}
                </span>
              </span>
              <span className="tabular shrink-0 font-medium text-primary">
                {formatCents(payment.remainingCents)} left
              </span>
            </button>

            {open === payment.id &&
              (payment.charges.length === 0 ? (
                <p className="mt-3 border-t border-border-soft pt-3 text-caption text-muted">
                  This team has no open obligations yet. Accept it and its charges appear here.
                </p>
              ) : (
                <form action={formAction} className="mt-3 border-t border-border-soft pt-3">
                  <ScopeFields scope={scope} />
                  <input type="hidden" name="paymentId" value={payment.id} />

                  <div className="grid gap-2 sm:grid-cols-3">
                    {payment.charges.map((charge) => {
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
                            name={`apply-${charge.id}`}
                            inputMode="decimal"
                            placeholder="0.00"
                            data-testid={`apply-${payment.bidCode}-${charge.kind}`}
                            className={cx(inputClass, "mt-1")}
                          />
                        </label>
                      );
                    })}
                  </div>

                  <button
                    type="submit"
                    disabled={pending}
                    data-testid={`apply-submit-${payment.bidCode}`}
                    className={cx(primaryButtonClass, "mt-3")}
                  >
                    Apply
                  </button>
                </form>
              ))}
          </li>
        ))}
      </ul>

      {state.message && (
        <p
          role="status"
          data-testid="apply-message"
          className={cx(
            "mt-3 text-caption",
            state.status === "error" ? "text-danger" : "text-muted",
          )}
        >
          {state.message}
        </p>
      )}

      <p className={cx(eyebrowClass, "mt-3")}>
        Attaching money never changes a balance — it says what the money was for.
      </p>
    </div>
  );
}
