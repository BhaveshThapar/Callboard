/**
 * A9 — who owes what, on one screen. The headline metric: hours to under a minute.
 *
 * A read over `listRosterForBoard` rather than a query of its own, because A3 already made "the
 * roster and what it owes" one record and a second definition of that would be the thing the window
 * rule exists to prevent. This only decides what to *show*, and the totals row is arithmetic over
 * exactly the rows shown — asserted in e2e, because that sum is the thing being sold.
 */
import { BILLABLE_STATUSES } from "@/db/schema/teams";
import type { RosterTeamView } from "@/lib/auth/scope";
import { toCsv } from "@/lib/export/csv";
import { generateCharges } from "@/lib/fees/schedule";
import type { BillingGap, FeeSchedule } from "@/lib/fees/types";
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
  /** What the schedule could not bill this team for, and why. Stated, never silently zero. */
  gaps: BillingGap[];
};

export type WhoOwes = {
  rows: WhoOwesRow[];
  totals: { owedCents: number; paidCents: number; balanceCents: number };
  outstandingCount: number;
  settledCount: number;
  creditCount: number;
};

const MISSING: Record<BillingGap["missing"], string> = {
  rosterSize: "roster size unknown",
  rooms: "room count unknown",
};

/**
 * A gap as a treasurer reads it. The wording says *not billed* rather than $0, because the whole
 * point of `BillingGap` is that those are different facts and only one of them is true.
 */
export const describeGap = (gap: BillingGap): string =>
  `${gap.kind.replace("_", " ")}: not billed — ${MISSING[gap.missing]}`;

/**
 * Teams that have money attached, worst first.
 *
 * A team with no charges and no payments is not listed at all: it is not "settled", it was never
 * billed, and putting a $0 row beside a team that genuinely owes nothing makes the screen answer a
 * question nobody asked. Ordering is by balance descending, so the board reads the chase list from
 * the top and stops when it runs out of debtors.
 *
 * The exception is a team the schedule *could not* bill. `generateCharges` withholds a line rather
 * than emitting a $0 one when a room count or a roster size is unknown, and says so in `gaps` — but
 * nothing rendered them, so a team with no room count simply owed $560 less than its neighbours and
 * the screen gave no reason. That is the failure the gap exists to prevent, reintroduced one layer
 * up. The gaps are recomputed here from the same pure function that withheld the line, so the screen
 * states exactly what the engine declined to charge and cannot drift from it.
 *
 * A team whose *only* fact is a gap therefore earns a row: "we could not bill this team" is the
 * answer to "who owes what", and it is the one answer that was previously invisible.
 */
export const whoOwes = (
  roster: readonly RosterTeamView[],
  schedule: FeeSchedule | null,
  asOf: string,
): WhoOwes => {
  const billable: readonly string[] = BILLABLE_STATUSES;
  const gapsByTeam = new Map<string, BillingGap[]>();

  if (schedule) {
    const { gaps } = generateCharges({
      schedule,
      teams: roster
        .filter((team) => billable.includes(team.status))
        .map((team) => ({ teamId: team.id, rosterSize: team.rosterSize, rooms: team.rooms })),
      asOf,
    });

    for (const gap of gaps) {
      gapsByTeam.set(gap.teamId, [...(gapsByTeam.get(gap.teamId) ?? []), gap]);
    }
  }

  const rows = roster
    .filter(
      (team) =>
        team.charges.length > 0 || team.balance.paidCents > 0 || gapsByTeam.has(team.id),
    )
    .map((team) => ({
      teamId: team.id,
      bidCode: team.bidCode,
      name: team.name,
      school: team.school,
      status: team.status,
      owedCents: team.balance.owedCents,
      paidCents: team.balance.paidCents,
      balanceCents: team.balance.balanceCents,
      gaps: gapsByTeam.get(team.id) ?? [],
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

export type PaymentRow = {
  receivedAt: Date;
  bidCode: string;
  teamName: string;
  rail: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  allocatedCents: number;
  refundedCents: number;
  externalRef: string | null;
  reconciledAt: Date | null;
};

/**
 * What arrived, one row per payment, as the file a treasurer reconciles against.
 *
 * A separate export from `toWhoOwesCsv` because it answers a separate question, and its rows are a
 * different thing: who-owes has one row per *team*, and a bank statement has one line per
 * *transaction*. Matching a statement against a per-team summary is the hand-unbundling this product
 * exists to remove, so the file that faces the bank has the bank's shape.
 *
 * `Reconciled` is the column `payments.reconciled_at` existed for and never had — the mark that says
 * a row has already been matched, so the second pass down a season does not start from nothing.
 * Gross, fee and net are all three present, because the statement shows the net and the team was
 * credited the gross, and that difference is the $97.01 deposit.
 *
 * `Refunded` is here for the same reason all three of those are. A returned deposit is a debit on
 * the statement the treasurer is reading, and a file that showed only what came in would leave them
 * matching an outflow against nothing — a discrepancy nobody was shown, which is what the ~$5,000
 * gap is made of (ADR-0015).
 */
export const toPaymentsCsv = (rows: readonly PaymentRow[]): string =>
  toCsv(
    [
      "Received",
      "Bid code",
      "Team",
      "Rail",
      "Gross",
      "Fee",
      "Net",
      "Attached",
      "Refunded",
      "Reference",
      "Reconciled",
    ],
    [
      ...rows.map((row) => [
        row.receivedAt.toISOString().slice(0, 10),
        row.bidCode,
        row.teamName,
        row.rail,
        formatCents(row.grossCents),
        formatCents(row.feeCents),
        formatCents(row.netCents),
        formatCents(row.allocatedCents),
        row.refundedCents === 0 ? "" : formatCents(row.refundedCents),
        row.externalRef ?? "",
        row.reconciledAt ? row.reconciledAt.toISOString().slice(0, 10) : "",
      ]),
      [
        "",
        "",
        "TOTAL",
        "",
        formatCents(rows.reduce((sum, row) => sum + row.grossCents, 0)),
        formatCents(rows.reduce((sum, row) => sum + row.feeCents, 0)),
        formatCents(rows.reduce((sum, row) => sum + row.netCents, 0)),
        formatCents(rows.reduce((sum, row) => sum + row.allocatedCents, 0)),
        formatCents(rows.reduce((sum, row) => sum + row.refundedCents, 0)),
        "",
        "",
      ],
    ],
  );

/**
 * The same rows as a file, through the existing `toCsv`. Dollars rather than cents, because this is
 * an edge — a treasurer opens it in a spreadsheet beside a bank statement, and cents would have to
 * be converted by hand, which is the arithmetic this product exists to remove.
 */
export const toWhoOwesCsv = (report: WhoOwes): string =>
  toCsv(
    ["Bid code", "Team", "School", "Status", "Owed", "Paid", "Balance", "Not billed"],
    [
      ...report.rows.map((row) => [
        row.bidCode,
        row.name,
        row.school ?? "",
        row.status,
        formatCents(row.owedCents),
        formatCents(row.paidCents),
        formatCents(row.balanceCents),
        // The caveat travels with the number. A file read beside a bank statement is exactly where
        // an unexplained short total gets mistaken for a team that paid in full.
        row.gaps.map(describeGap).join("; "),
      ]),
      [
        "",
        "TOTAL",
        "",
        "",
        formatCents(report.totals.owedCents),
        formatCents(report.totals.paidCents),
        formatCents(report.totals.balanceCents),
        "",
      ],
    ],
  );
