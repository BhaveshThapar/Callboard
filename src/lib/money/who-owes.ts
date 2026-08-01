/**
 * A9 — who owes what, on one screen. The headline metric: hours to under a minute.
 *
 * A read over `listRosterForBoard` rather than a query of its own, because A3 already made "the
 * roster and what it owes" one record and a second definition of that would be the thing the window
 * rule exists to prevent. This only decides what to *show*, and the totals row is arithmetic over
 * exactly the rows shown — asserted in e2e, because that sum is the thing being sold.
 */
import type { RosterTeamView } from "@/lib/auth/scope";
import { toCsv } from "@/lib/export/csv";
import { formatCents } from "./format";

export type WhoOwesRow = {
  teamId: string;
  bidCode: string;
  name: string;
  school: string | null;
  status: string;
  owedCents: number;
  paidCents: number;
  balanceCents: number;
};

export type WhoOwes = {
  rows: WhoOwesRow[];
  totals: { owedCents: number; paidCents: number; balanceCents: number };
  /** Teams the schedule could not fully bill, and why. Stated, never silently zero. */
  outstandingCount: number;
  settledCount: number;
  creditCount: number;
};

/**
 * Teams that have money attached, worst first.
 *
 * A team with no charges and no payments is not listed at all: it is not "settled", it was never
 * billed, and putting a $0 row beside a team that genuinely owes nothing makes the screen answer a
 * question nobody asked. Ordering is by balance descending, so the board reads the chase list from
 * the top and stops when it runs out of debtors.
 */
export const whoOwes = (roster: readonly RosterTeamView[]): WhoOwes => {
  const rows = roster
    .filter((team) => team.charges.length > 0 || team.balance.paidCents > 0)
    .map((team) => ({
      teamId: team.id,
      bidCode: team.bidCode,
      name: team.name,
      school: team.school,
      status: team.status,
      owedCents: team.balance.owedCents,
      paidCents: team.balance.paidCents,
      balanceCents: team.balance.balanceCents,
    }))
    .sort((a, b) => b.balanceCents - a.balanceCents || a.name.localeCompare(b.name));

  const totals = rows.reduce(
    (acc, row) => ({
      owedCents: acc.owedCents + row.owedCents,
      paidCents: acc.paidCents + row.paidCents,
      balanceCents: acc.balanceCents + row.balanceCents,
    }),
    { owedCents: 0, paidCents: 0, balanceCents: 0 },
  );

  return {
    rows,
    totals,
    outstandingCount: rows.filter((row) => row.balanceCents > 0).length,
    settledCount: rows.filter((row) => row.balanceCents === 0).length,
    creditCount: rows.filter((row) => row.balanceCents < 0).length,
  };
};

/**
 * How much arrived that nobody has said the purpose of.
 *
 * Lives beside `whoOwes` because it answers the same screen's second question, and is pure for the
 * same reason: the total a board reads has to be arithmetic over exactly the rows beneath it.
 *
 * A fully attached payment is **excluded**, not shown as $0 — the same rule as a team that was never
 * billed. A list of things needing attention should contain only things needing attention.
 */
export const summarizeOpenPayments = (
  payments: readonly { remainingCents: number }[],
): { count: number; totalRemainingCents: number } => {
  const open = payments.filter((payment) => payment.remainingCents > 0);
  return {
    count: open.length,
    totalRemainingCents: open.reduce((sum, payment) => sum + payment.remainingCents, 0),
  };
};

/**
 * The same rows as a file, through the existing `toCsv`. Dollars rather than cents, because this is
 * an edge — a treasurer opens it in a spreadsheet beside a bank statement, and cents would have to
 * be converted by hand, which is the arithmetic this product exists to remove.
 */
export const toWhoOwesCsv = (report: WhoOwes): string =>
  toCsv(
    ["Bid code", "Team", "School", "Status", "Owed", "Paid", "Balance"],
    [
      ...report.rows.map((row) => [
        row.bidCode,
        row.name,
        row.school ?? "",
        row.status,
        formatCents(row.owedCents),
        formatCents(row.paidCents),
        formatCents(row.balanceCents),
      ]),
      [
        "",
        "TOTAL",
        "",
        "",
        formatCents(report.totals.owedCents),
        formatCents(report.totals.paidCents),
        formatCents(report.totals.balanceCents),
      ],
    ],
  );
