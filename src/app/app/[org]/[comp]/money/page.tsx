import { notFound } from "next/navigation";
import type { BoardFormScope } from "../state";
import { cardClass, cx, eyebrowClass, pillClass } from "@/components/styles";
import { listRosterForBoard } from "@/lib/auth/scope";
import { resolveBoardAccessBySlugs } from "@/lib/auth/access";
import { latestLockedRun } from "@/lib/comp/tab";
import { feeScheduleFor, today } from "@/lib/money/charges";
import { listDepositsForBoard } from "@/lib/money/deposits";
import { describeBalance, formatCents } from "@/lib/money/format";
import { listOpenPayments, listPaymentsForBoard } from "@/lib/money/ledger";
import { stripeConfigured } from "@/lib/stripe/client";
import { connectForBoard } from "@/lib/stripe/connect";
import { describeGap, summarizeOpenPayments, whoOwes } from "@/lib/money/who-owes";
import { StripeConnect } from "./StripeConnect";
import { DepositTable } from "./DepositTable";
import type { DebtorOption } from "./DuesReminders";
import { DuesReminders } from "./DuesReminders";
import type { PaymentRowView } from "./PaymentsTable";
import { PaymentsTable } from "./PaymentsTable";
import type { PayableTeam } from "./RecordPayment";
import { RecordPayment } from "./RecordPayment";
import { RegenerateCharges } from "./RegenerateCharges";
import type { OpenPaymentView } from "./UnattributedCredit";
import { UnattributedCredit } from "./UnattributedCredit";

export const dynamic = "force-dynamic";

/**
 * A9 — the screen the whole money spine is for. A treasurer's answer to "who still owes us", which
 * took hours across an acceptance doc and a Venmo thread, in one page.
 *
 * The totals row is arithmetic over exactly the rows above it, and `e2e/money.spec.ts` asserts that
 * it is: a summary that disagrees with its own rows is the ~$5,000 gap in miniature, and it is the
 * one number a board would carry into a meeting without re-deriving.
 */
export default async function MoneyPage({ params }: { params: Promise<{ org: string; comp: string }> }) {
  const { org, comp } = await params;

  const actor = await resolveBoardAccessBySlugs(org, comp);
  if (!actor) notFound();

  const scope: BoardFormScope = { compId: actor.compId, basePath: `/app/${org}/${comp}` };
  const stripe = await connectForBoard(actor);

  /**
   * `listDepositsForBoard` calls `listRosterForBoard` again internally, and that duplicate read is
   * deliberate. Threading the roster in as a parameter would create a way to hand it a roster that
   * did not come from the window — which is exactly what the window rule exists to prevent — and
   * this page is `force-dynamic` over a comp of 8–30 teams. The cheaper of the two costs.
   */
  const [roster, openPayments, allPayments, deposits, schedule, locked] = await Promise.all([
    listRosterForBoard(actor),
    listOpenPayments(actor),
    listPaymentsForBoard(actor),
    listDepositsForBoard(actor),
    feeScheduleFor(actor.compId),
    latestLockedRun(actor.compId),
  ]);
  const report = whoOwes(roster, schedule, today());
  const credit = summarizeOpenPayments(openPayments);

  // The same rows the reminder action will plan over, so the count on the button and the number of
  // emails that leave cannot disagree — both are `whoOwes` over this comp's roster.
  const debtors: DebtorOption[] = report.rows
    .filter((row) => row.balanceCents > 0)
    .map((row) => ({
      id: row.teamId,
      name: row.name,
      bidCode: row.bidCode,
      balance: formatCents(row.balanceCents),
    }));

  const chargesByTeam = new Map(roster.map((team) => [team.id, team.charges]));
  const openViews: OpenPaymentView[] = openPayments.map((payment) => ({
    id: payment.id,
    teamName: payment.teamName,
    bidCode: payment.bidCode,
    rail: payment.rail,
    receivedAt: payment.receivedAt.toISOString().slice(0, 10),
    grossCents: payment.grossCents,
    remainingCents: payment.remainingCents,
    charges: (chargesByTeam.get(payment.teamId) ?? []).map((charge) => ({
      id: charge.id,
      kind: charge.kind,
      amountCents: charge.amountCents,
      paidCents: charge.paidCents,
    })),
  }));

  const paymentRows: PaymentRowView[] = allPayments.map((payment) => ({
    id: payment.id,
    teamName: payment.teamName,
    bidCode: payment.bidCode,
    rail: payment.rail,
    receivedAt: payment.receivedAt.toISOString().slice(0, 10),
    grossCents: payment.grossCents,
    feeCents: payment.feeCents,
    allocatedCents: payment.allocatedCents,
    externalRef: payment.externalRef,
    reconciled: payment.reconciledAt !== null,
    allocations: payment.allocations,
  }));

  // Every team, not only the billed ones: a team paying a deposit to hold a slot is `applied` and
  // has no charges yet, and that is the normal order of events rather than an edge case.
  const payable: PayableTeam[] = roster.map((team) => ({
    id: team.id,
    name: team.name,
    bidCode: team.bidCode,
    status: team.status,
    charges: team.charges.map((charge) => ({
      id: charge.id,
      kind: charge.kind,
      amountCents: charge.amountCents,
      paidCents: charge.paidCents,
    })),
  }));

  return (
    <>
      <div className="max-w-4xl">
        <header className="mb-6 flex items-end justify-between gap-4">
          <h2 className={eyebrowClass}>Who owes what</h2>
          <div className="flex items-center gap-4">
            {report.rows.length > 0 && (
              <a
                href={`${scope.basePath}/money/export`}
                data-testid="money-csv"
                className="text-caption text-primary underline underline-offset-2"
              >
                Who owes CSV
              </a>
            )}
            {paymentRows.length > 0 && (
              <a
                href={`${scope.basePath}/money/payments`}
                data-testid="payments-csv"
                className="text-caption text-primary underline underline-offset-2"
              >
                Payments CSV
              </a>
            )}
          </div>
        </header>

        {/* Outside the `report.rows.length` branch below, deliberately: the case this exists for is
            a comp whose teams are billable and whose charges are *missing* — a late fee whose date
            passed, a room count that has just been filled in — and an empty screen is exactly when a
            board most needs the button. */}
        {schedule && !locked && (
          <div className="mb-6">
            <RegenerateCharges scope={scope} />
          </div>
        )}

        {payable.length > 0 && (
          <div className="mb-6">
            <RecordPayment scope={scope} teams={payable} />
          </div>
        )}

        <div className="mb-6">
          <UnattributedCredit
            scope={scope}
            payments={openViews}
            totalRemainingCents={credit.totalRemainingCents}
          />
        </div>

        {paymentRows.length > 0 && (
          <div className="mb-6">
            <PaymentsTable scope={scope} payments={paymentRows} />
          </div>
        )}

        <div className="mb-6">
          <DepositTable scope={scope} deposits={deposits} />
        </div>

        {/* Above the table it acts on, and rendered even with nobody outstanding: a board that has
            just chased everybody should still see the panel that says so, rather than watching the
            instrument disappear at the moment it worked. */}
        <div className="mb-6">
          <DuesReminders scope={scope} debtors={debtors} />

          <StripeConnect scope={scope} configured={stripeConfigured()} view={stripe} />
        </div>

        {report.rows.length === 0 ? (
          <div className={cardClass}>
            <p className="text-body text-muted">
              No team has been billed yet. Charges are generated when a team is accepted, from the
              comp&apos;s fee schedule — a comp with no schedule bills nothing. Regenerating re-runs
              that schedule over every billable team, which is how a late fee reaches a team accepted
              months before its date.
            </p>
          </div>
        ) : (
          <div className={cardClass}>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-card font-semibold text-heading">
                {report.outstandingCount} outstanding
              </h2>
              <p className="text-caption text-muted">
                {report.settledCount} settled
                {report.creditCount > 0 && ` · ${report.creditCount} owed a refund`}
              </p>
            </div>

            <table className="mt-4 w-full text-body" data-testid="who-owes">
              <thead>
                <tr className="border-b border-border-soft text-left">
                  <th className={cx(eyebrowClass, "pb-2")}>Team</th>
                  <th className={cx(eyebrowClass, "pb-2")}>Status</th>
                  <th className={cx(eyebrowClass, "pb-2 text-right")}>Owed</th>
                  <th className={cx(eyebrowClass, "pb-2 text-right")}>Paid</th>
                  <th className={cx(eyebrowClass, "pb-2 text-right")}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr
                    key={row.teamId}
                    data-testid={`owes-row-${row.bidCode}`}
                    data-balance-cents={row.balanceCents}
                    className="border-b border-border-soft/60"
                  >
                    <td className="py-2.5 pr-3">
                      <span className="font-medium text-heading">{row.name}</span>
                      <span className="block text-caption text-subtle">{row.bidCode}</span>
                      {/* `paidCents` per charge was computed by `listRosterForBoard` and rendered
                          by nothing, which left "is the security deposit paid?" unanswerable — and
                          that is the question A7's whole refund chain sits on top of. */}
                      {(chargesByTeam.get(row.teamId) ?? []).map((charge) => (
                        <span
                          key={charge.id}
                          data-testid={`charge-${row.bidCode}-${charge.kind}`}
                          data-paid-cents={charge.paidCents}
                          className="block text-micro text-subtle"
                        >
                          {charge.kind.replace("_", " ")}: {formatCents(charge.paidCents)} of{" "}
                          {formatCents(charge.amountCents)}
                        </span>
                      ))}
                      {/* Without this line the team simply owes less than its neighbours and the
                          screen gives no reason -- which is the $0-hotel-charge lie wearing a
                          different hat. `generateCharges` already withheld the line and said why. */}
                      {row.gaps.map((gap) => (
                        <span
                          key={`${gap.kind}-${gap.missing}`}
                          data-testid={`gap-${row.bidCode}-${gap.kind}`}
                          className="block text-micro text-primary"
                        >
                          {describeGap(gap)}
                        </span>
                      ))}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={cx(pillClass, "bg-hover text-muted")}>{row.status}</span>
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-muted">
                      {formatCents(row.owedCents)}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-muted">
                      {formatCents(row.paidCents)}
                    </td>
                    <td
                      className={cx(
                        "tabular py-2.5 text-right font-medium",
                        row.balanceCents > 0
                          ? "text-heading"
                          : row.balanceCents < 0
                            ? "text-primary"
                            : "text-subtle",
                      )}
                    >
                      {describeBalance(row.balanceCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr data-testid="who-owes-total" data-balance-cents={report.totals.balanceCents}>
                  <td className="py-2.5 pr-3 font-semibold text-heading">Total</td>
                  <td />
                  <td className="tabular py-2.5 pr-3 text-right font-semibold text-heading">
                    {formatCents(report.totals.owedCents)}
                  </td>
                  <td className="tabular py-2.5 pr-3 text-right font-semibold text-heading">
                    {formatCents(report.totals.paidCents)}
                  </td>
                  <td className="tabular py-2.5 text-right font-semibold text-heading">
                    {formatCents(report.totals.balanceCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
