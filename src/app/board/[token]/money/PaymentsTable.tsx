"use client";

import { Fragment, useActionState } from "react";
import { cardClass, cx, eyebrowClass, pillClass } from "@/components/styles";
import { unallocatedCents } from "@/lib/money/balance";
import type { AllocationView } from "@/lib/money/ledger";
import { formatCents } from "@/lib/money/format";
import { reconcilePaymentAction, releaseAllocationAction } from "../actions";
import { IDLE } from "../state";

export type PaymentRowView = {
  id: string;
  teamName: string;
  bidCode: string;
  rail: string;
  receivedAt: string;
  grossCents: number;
  feeCents: number;
  allocatedCents: number;
  externalRef: string | null;
  reconciled: boolean;
  allocations: AllocationView[];
};

/**
 * Everything that arrived, and which of it has been matched against the bank.
 *
 * The screen `payments.reconciled_at` was waiting for since migration `0009`. Until now the column
 * existed, nothing wrote it, and a treasurer reconciling a season had to remember where they got to
 * — which is how the ~$5,000 gap survives being looked for rather than how it is created.
 *
 * `fee` is rendered beside gross rather than folded into it, because the bank shows the net and the
 * team was credited the gross: BU Dheem's $100 deposit arriving as $97.01 is two numbers and one
 * recorded cost, and a table showing one of them is the desync this table exists to catch.
 */
export function PaymentsTable({
  token,
  payments,
}: {
  token: string;
  payments: PaymentRowView[];
}) {
  const [state, action, pending] = useActionState(reconcilePaymentAction, IDLE);
  const [release, releaseAction, releasing] = useActionState(releaseAllocationAction, IDLE);

  if (payments.length === 0) return null;

  const unreconciled = payments.filter((payment) => !payment.reconciled);
  const outstandingCents = unreconciled.reduce((sum, payment) => sum + payment.grossCents, 0);

  return (
    <div className={cardClass} data-testid="payments">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-card font-semibold text-heading">What arrived</h2>
        <p className="text-caption text-muted" data-testid="payments-unreconciled">
          {unreconciled.length === 0
            ? "all matched against the bank"
            : `${unreconciled.length} not matched · ${formatCents(outstandingCents)}`}
        </p>
      </div>

      <table className="mt-4 w-full text-body">
        <thead>
          <tr className="border-b border-border-soft text-left">
            <th className={cx(eyebrowClass, "pb-2")}>Received</th>
            <th className={cx(eyebrowClass, "pb-2")}>Team</th>
            <th className={cx(eyebrowClass, "pb-2")}>Rail</th>
            <th className={cx(eyebrowClass, "pb-2 text-right")}>Gross</th>
            <th className={cx(eyebrowClass, "pb-2 text-right")}>Fee</th>
            <th className={cx(eyebrowClass, "pb-2")}>Bank</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <Fragment key={payment.id}>
            <tr
              data-testid={`payment-row-${payment.id}`}
              data-reconciled={payment.reconciled}
              className={cx(payment.allocations.length === 0 && "border-b border-border-soft/60")}
            >
              <td className="tabular py-2.5 pr-3 text-caption text-muted">{payment.receivedAt}</td>
              <td className="py-2.5 pr-3">
                <span className="font-medium text-heading">{payment.teamName}</span>
                <span className="block text-caption text-subtle">
                  {payment.bidCode}
                  {payment.externalRef && ` · ${payment.externalRef}`}
                </span>
              </td>
              <td className="py-2.5 pr-3">
                <span className={cx(pillClass, "bg-hover text-muted")}>{payment.rail}</span>
              </td>
              <td className="tabular py-2.5 pr-3 text-right text-muted">
                {formatCents(payment.grossCents)}
                {unallocatedCents(payment) > 0 && (
                  <span className="block text-micro text-subtle">
                    {formatCents(unallocatedCents(payment))} unattached
                  </span>
                )}
              </td>
              <td className="tabular py-2.5 pr-3 text-right text-subtle">
                {payment.feeCents > 0 ? formatCents(payment.feeCents) : "—"}
              </td>
              <td className="py-2.5">
                <form action={action}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <input
                    type="hidden"
                    name="reconciled"
                    value={payment.reconciled ? "false" : "true"}
                  />
                  <button
                    type="submit"
                    disabled={pending}
                    data-testid={`reconcile-${payment.id}`}
                    className={cx(
                      "rounded border px-1.5 py-0.5 text-micro transition-colors disabled:opacity-40",
                      payment.reconciled
                        ? "border-primary text-primary"
                        : "border-border text-muted hover:border-primary hover:text-primary",
                    )}
                  >
                    {payment.reconciled ? "matched ✓" : "mark matched"}
                  </button>
                </form>
              </td>
            </tr>

            {/**
              * What this payment was said to be for, and the way to take it back.
              *
              * Under the payment rather than beside the charge, because that is the treasurer's own
              * sentence: *"this $2,160 — I put $560 on the deposit by mistake."* The who-owes screen
              * answers how much of an obligation is settled; only here is there a row to point at.
              */}
            {payment.allocations.length > 0 && (
              <tr className="border-b border-border-soft/60">
                <td />
                <td colSpan={5} className="pb-2.5 pr-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {payment.allocations.map((allocation) => (
                      <form key={allocation.id} action={releaseAction} className="contents">
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="allocationId" value={allocation.id} />
                        <span
                          data-testid={`allocation-${allocation.id}`}
                          className="text-micro text-subtle"
                        >
                          {allocation.chargeKind.replace("_", " ")}{" "}
                          <span className="tabular">{formatCents(allocation.amountCents)}</span>
                          <button
                            type="submit"
                            disabled={releasing}
                            data-testid={`release-${allocation.id}`}
                            title="Detach this money from that obligation. No balance moves."
                            className="ml-1 text-subtle underline underline-offset-2 transition-colors hover:text-danger disabled:opacity-40"
                          >
                            release
                          </button>
                        </span>
                      </form>
                    ))}
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>

      {release.message && (
        <p
          role="status"
          data-testid="release-message"
          className={cx(
            "mt-3 text-caption",
            release.status === "error" ? "text-danger" : "text-muted",
          )}
        >
          {release.message}
        </p>
      )}

      {state.message && (
        <p
          role="status"
          data-testid="payments-message"
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
