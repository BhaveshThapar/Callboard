import Link from "next/link";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { cardClass, cx, eyebrowClass, pillClass } from "@/components/styles";
import { listRosterForBoard, resolveBoardActor } from "@/lib/auth/scope";
import { describeBalance, formatCents } from "@/lib/money/format";
import { whoOwes } from "@/lib/money/who-owes";

export const dynamic = "force-dynamic";

/**
 * A9 — the screen the whole money spine is for. A treasurer's answer to "who still owes us", which
 * took hours across an acceptance doc and a Venmo thread, in one page.
 *
 * The totals row is arithmetic over exactly the rows above it, and `e2e/money.spec.ts` asserts that
 * it is: a summary that disagrees with its own rows is the ~$5,000 gap in miniature, and it is the
 * one number a board would carry into a meeting without re-deriving.
 */
export default async function MoneyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const actor = await resolveBoardActor(token);
  if (!actor) notFound();

  const report = whoOwes(await listRosterForBoard(actor));

  return (
    <div className="bg-app min-h-screen">
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Wordmark />

        <header className="mt-8 mb-6 flex items-end justify-between gap-4">
          <div>
            <p className={eyebrowClass}>{actor.compName}</p>
            <h1 className="mt-1 text-title font-bold text-heading">Who owes what</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href={`/board/${token}/roster`}
              className="text-caption text-muted underline underline-offset-2 hover:text-primary"
            >
              Registration →
            </Link>
            {report.rows.length > 0 && (
              <a
                href={`/board/${token}/money/export`}
                data-testid="money-csv"
                className="text-caption text-primary underline underline-offset-2"
              >
                Download CSV
              </a>
            )}
          </div>
        </header>

        {report.rows.length === 0 ? (
          <div className={cardClass}>
            <p className="text-body text-muted">
              No team has been billed yet. Charges are generated when a team is accepted, from the
              comp&apos;s fee schedule — a comp with no schedule bills nothing.
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
      </main>
    </div>
  );
}
