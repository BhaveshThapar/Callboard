"use client";

import { useActionState } from "react";
import { cardClass, cx, eyebrowClass, inputClass, pillClass } from "@/components/styles";
import type { DepositState } from "@/lib/money/deposit";
import type { DepositView } from "@/lib/money/deposits";
import { formatCents } from "@/lib/money/format";
import { advanceDepositAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import type { BoardFormScope } from "../state";
import { IDLE } from "../state";

const STATE_TONE: Record<DepositState, string> = {
  held: "bg-hover text-muted",
  refund_pending: "bg-secondary-light text-secondary",
  refunded: "bg-primary-light text-primary",
  forfeited: "bg-hover text-subtle",
  refund_failed: "bg-hover text-danger",
};

const label = (state: DepositState) => state.replace("_", " ");

/**
 * A7 on the screen. The buttons are `deposit.canMoveTo`, which `listDepositsForBoard` computes from
 * the pure `allowedFrom` — the same shape `RosterTable` already uses for a status move, so the
 * machine is the only thing deciding what is offered.
 *
 * A terminal deposit renders its state and no buttons. The state *is* the row, so `refunded` reads
 * as finished without needing a disabled control to say so — and `deposit_events_terminal_unique`
 * is what actually guarantees it, for the two board members who click at the same moment.
 */
export function DepositTable({ scope, deposits }: { scope: BoardFormScope; deposits: DepositView[] }) {
  const [state, formAction, pending] = useActionState(advanceDepositAction, IDLE);

  if (deposits.length === 0) return null;

  const outstanding = deposits.filter((row) => row.state === "held").length;

  return (
    <div className={cardClass} data-testid="deposits">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-card font-semibold text-heading">Deposits</h2>
        <p className="text-caption text-muted">{outstanding} still held</p>
      </div>
      <p className="mt-1 text-caption text-muted">
        A deposit ends once. Returning one is the expected ending; keeping one needs a reason.
      </p>

      <table className="mt-4 w-full text-body">
        <thead>
          <tr className="border-b border-border-soft text-left">
            <th className={cx(eyebrowClass, "pb-2")}>Team</th>
            <th className={cx(eyebrowClass, "pb-2 text-right")}>Amount</th>
            <th className={cx(eyebrowClass, "pb-2 text-right")}>Paid</th>
            <th className={cx(eyebrowClass, "pb-2")}>State</th>
            <th className={cx(eyebrowClass, "pb-2")}>Move to</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((deposit) => (
            <tr
              key={deposit.teamId}
              data-testid={`deposit-row-${deposit.bidCode}`}
              data-state={deposit.state}
              data-paid-cents={deposit.paidCents}
              data-settled={deposit.settled}
              className="border-b border-border-soft/60"
            >
              <td className="py-2.5 pr-3">
                <span className="font-medium text-heading">{deposit.teamName}</span>
                <span className="block text-caption text-subtle">
                  {deposit.bidCode}
                  {/* A dropped team's deposit is the one a board most needs to decide about, and it
                      used to vanish from this table at exactly that moment. Saying the obligation is
                      gone is not the same as saying the money is. */}
                  {deposit.settled && " · no longer owed"}
                </span>
              </td>
              <td className="tabular py-2.5 pr-3 text-right text-muted">
                {formatCents(deposit.amountCents)}
              </td>
              <td className="tabular py-2.5 pr-3 text-right text-subtle">
                {deposit.paidCents === 0 ? "—" : formatCents(deposit.paidCents)}
              </td>
              <td className="py-2.5 pr-3">
                <span className={cx(pillClass, STATE_TONE[deposit.state])}>
                  {label(deposit.state)}
                </span>
              </td>
              <td className="py-2.5">
                {deposit.canMoveTo.length === 0 ? (
                  <span className="text-caption text-subtle">—</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {deposit.canMoveTo.map((to) => (
                      <form key={to} action={formAction} className="flex items-center gap-1">
                        <ScopeFields scope={scope} />
                        <input type="hidden" name="teamId" value={deposit.teamId} />
                        <input type="hidden" name="state" value={to} />
                        {to === "forfeited" && (
                          <input
                            name="reason"
                            placeholder="why"
                            aria-label={`Reason for forfeiting ${deposit.teamName}'s deposit`}
                            data-testid={`deposit-reason-${deposit.bidCode}`}
                            className={cx(inputClass, "w-28 px-2 py-0.5 text-micro")}
                          />
                        )}
                        <button
                          type="submit"
                          disabled={pending}
                          data-testid={`deposit-${deposit.bidCode}-${to}`}
                          className="rounded border border-border px-1.5 py-0.5 text-micro text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                        >
                          {label(to)}
                        </button>
                      </form>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {state.message && (
        <p
          role="status"
          data-testid="deposit-message"
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
