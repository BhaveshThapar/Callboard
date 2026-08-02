import { describe, expect, it } from "vitest";
import type { RosterTeamView } from "@/lib/auth/scope";
import type { FeeSchedule } from "@/lib/fees/types";
import { teamBalance } from "../balance";
import type { PaymentRow } from "../who-owes";
import { summarizeOpenPayments, toPaymentsCsv, toWhoOwesCsv, whoOwes } from "../who-owes";

/** Mayuri 2026's real numbers: $70/dancer + $140/room + a $100 deposit. */
const SCHEDULE: FeeSchedule = {
  perDancerCents: 7000,
  perRoomCents: 14000,
  depositCents: 10000,
  lateFeeCents: 2500,
  lateAfter: "2027-02-01",
};

const ASOF = "2026-12-01";

/**
 * Room count and roster size default to *known*, so a test that says nothing about them gets no
 * billing gap and keeps meaning what it meant before gaps existed. The gap cases name them.
 */
const team = (
  bidCode: string,
  name: string,
  owedCents: number,
  paidCents: number,
  known: { rosterSize?: number | null; rooms?: number | null } = {},
): RosterTeamView => {
  const charges =
    owedCents > 0
      ? [{ id: `${bidCode}-c`, kind: "registration", amountCents: owedCents, paidCents }]
      : [];

  return {
    id: bidCode,
    bidCode,
    name,
    school: null,
    performanceOrder: null,
    status: "accepted",
    waitlistRank: null,
    rosterSize: known.rosterSize === undefined ? 16 : known.rosterSize,
    rooms: known.rooms === undefined ? 4 : known.rooms,
    auditionUrl: null,
    waiverAcceptedAt: null,
    contactName: null,
    contactEmail: null,
    customAnswers: null,
    charges,
    balance: teamBalance(charges, paidCents),
  };
};

describe("whoOwes", () => {
  it("lists debtors first, so the chase list reads from the top", () => {
    const report = whoOwes(
      [
        team("A-1", "Settled", 100_000, 100_000),
        team("A-2", "Owes most", 200_000, 0),
        team("A-3", "Owes some", 150_000, 100_000),
      ],
      SCHEDULE,
      ASOF,
    );

    expect(report.rows.map((r) => r.bidCode)).toEqual(["A-2", "A-3", "A-1"]);
    expect(report.outstandingCount).toBe(2);
    expect(report.settledCount).toBe(1);
  });

  /**
   * A team that was never billed is not "settled" — it has no obligations at all. A $0 row beside a
   * team that genuinely owes nothing makes the screen answer a question nobody asked, and inflates
   * the settled count with teams nobody ever chased.
   */
  it("omits a team with no charges and no payments rather than showing it as settled", () => {
    const report = whoOwes(
      [team("A-1", "Billed", 100_000, 0), team("A-2", "Never billed", 0, 0)],
      SCHEDULE,
      ASOF,
    );

    expect(report.rows.map((r) => r.bidCode)).toEqual(["A-1"]);
    expect(report.settledCount).toBe(0);
  });

  it("keeps a team the org owes money to, and counts it separately", () => {
    // Paid, then dropped: charges voided, money still in the org's account.
    const report = whoOwes([team("A-1", "Refund due", 0, 112_000)], SCHEDULE, ASOF);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.balanceCents).toBe(-112_000);
    expect(report.creditCount).toBe(1);
    expect(report.outstandingCount).toBe(0);
  });

  /**
   * The number a board carries into a meeting without re-deriving it. A totals row that disagrees
   * with the rows above it is the ~$5,000 gap in miniature.
   */
  it("totals exactly the rows it shows", () => {
    const rows = [
      team("A-1", "One", 178_000, 10_000),
      team("A-2", "Two", 216_000, 216_000),
      team("A-3", "Three", 80_000, 0),
      team("A-4", "Never billed", 0, 0),
    ];
    const report = whoOwes(rows, SCHEDULE, ASOF);

    const summed = report.rows.reduce(
      (acc, row) => ({
        owed: acc.owed + row.owedCents,
        paid: acc.paid + row.paidCents,
        balance: acc.balance + row.balanceCents,
      }),
      { owed: 0, paid: 0, balance: 0 },
    );

    expect(report.totals.owedCents).toBe(summed.owed);
    expect(report.totals.paidCents).toBe(summed.paid);
    expect(report.totals.balanceCents).toBe(summed.balance);
    expect(report.totals.balanceCents).toBe(report.totals.owedCents - report.totals.paidCents);
  });

  it("is empty for a comp that bills nothing", () => {
    const report = whoOwes([team("A-1", "One", 0, 0)], null, ASOF);
    expect(report.rows).toEqual([]);
    expect(report.totals).toEqual({ owedCents: 0, paidCents: 0, balanceCents: 0 });
  });
});

/**
 * The gap is why a team owes less than its neighbours. `generateCharges` withholds the line rather
 * than emitting a $0 one — "a $0 hotel charge is a lie a treasurer will believe" — and until this
 * was rendered, the withholding was as silent as the lie would have been.
 */
describe("whoOwes billing gaps", () => {
  it("says why a team with no room count was not billed for a hotel", () => {
    const report = whoOwes([team("A-1", "No rooms", 112_000, 0, { rooms: null })], SCHEDULE, ASOF);

    expect(report.rows[0]?.gaps).toEqual([
      { teamId: "A-1", kind: "hotel", missing: "rooms" },
    ]);
  });

  it("says nothing when the room count is known", () => {
    const report = whoOwes([team("A-1", "Known", 112_000, 0)], SCHEDULE, ASOF);
    expect(report.rows[0]?.gaps).toEqual([]);
  });

  /**
   * A comp that does not bill per room is not missing anything when a room count is absent. The gap
   * is a property of the schedule and the roster together, never of the roster alone.
   */
  it("says nothing when the schedule does not bill for the missing thing", () => {
    const report = whoOwes(
      [team("A-1", "No rooms", 112_000, 0, { rooms: null })],
      { ...SCHEDULE, perRoomCents: 0 },
      ASOF,
    );

    expect(report.rows[0]?.gaps).toEqual([]);
  });

  /**
   * The case that was invisible: nothing could be billed at all, so there were no charges, so the
   * team did not appear — the screen answered "who owes what" by silently omitting the team it
   * could not answer for.
   */
  it("gives a row to a team whose only fact is that it could not be billed", () => {
    const report = whoOwes(
      [team("A-1", "Unbillable", 0, 0, { rosterSize: null, rooms: null })],
      SCHEDULE,
      ASOF,
    );

    expect(report.rows.map((r) => r.bidCode)).toEqual(["A-1"]);
    expect(report.rows[0]?.owedCents).toBe(0);
    expect(report.rows[0]?.gaps.map((g) => g.kind).sort()).toEqual(["hotel", "registration"]);
  });

  /** A dropped team is not being billed, so there is nothing the schedule failed to bill it for. */
  it("states no gap for a team that is not in a billable status", () => {
    const dropped: RosterTeamView = {
      ...team("A-1", "Dropped", 0, 0, { rooms: null }),
      status: "dropped",
    };
    const report = whoOwes([dropped], SCHEDULE, ASOF);

    expect(report.rows).toEqual([]);
  });
});

describe("toWhoOwesCsv", () => {
  it("carries dollars, because a treasurer opens it beside a bank statement", () => {
    const csv = toWhoOwesCsv(whoOwes([team("A-1", "One", 178_000, 10_000)], SCHEDULE, ASOF));

    expect(csv).toContain("Bid code,Team,School,Status,Owed,Paid,Balance,Not billed");
    expect(csv).toContain("$1,780.00");
    expect(csv).toContain("$100.00");
    expect(csv).toContain("$1,680.00");
  });

  /**
   * The caveat travels with the number. A file read beside a bank statement is exactly where a short
   * total gets mistaken for a team that paid in full.
   */
  it("carries the reason a team was under-billed", () => {
    const csv = toWhoOwesCsv(
      whoOwes([team("A-1", "No rooms", 112_000, 0, { rooms: null })], SCHEDULE, ASOF),
    );

    expect(csv).toContain("hotel: not billed — room count unknown");
  });

  it("ends with a TOTAL row that matches the report", () => {
    const report = whoOwes(
      [team("A-1", "One", 100_000, 0), team("A-2", "Two", 50_000, 50_000)],
      SCHEDULE,
      ASOF,
    );
    const lines = toWhoOwesCsv(report).split("\r\n");

    expect(lines.at(-1)).toContain("TOTAL");
    expect(lines.at(-1)).toContain("$1,000.00");
  });
});

describe("toPaymentsCsv", () => {
  const payment = (
    bidCode: string,
    grossCents: number,
    feeCents: number,
    reconciledAt: Date | null,
    refundedCents = 0,
  ): PaymentRow => ({
    receivedAt: new Date("2027-01-14T15:04:00Z"),
    bidCode,
    teamName: `Team ${bidCode}`,
    rail: "venmo",
    grossCents,
    feeCents,
    netCents: grossCents - feeCents,
    allocatedCents: grossCents,
    refundedCents,
    externalRef: null,
    reconciledAt,
  });

  it("carries gross, fee and net as three numbers — the $97.01 case in a file", () => {
    // BU Dheem's $100 deposit landed as $97.01. The team was credited $100; the bank shows $97.01;
    // the $2.99 is a recorded cost. A file showing one of the three is the desync itself.
    const csv = toPaymentsCsv([payment("B-207", 10_000, 299, null)]);

    expect(csv).toContain("$100.00");
    expect(csv).toContain("$2.99");
    expect(csv).toContain("$97.01");
  });

  /**
   * A returned deposit is a *debit* on the statement the treasurer is matching against. Without
   * this column the file showed only what came in, so an outflow on the bank side matched nothing
   * in the file — a discrepancy nobody was shown, which is the shape the ~$5,000 gap is made of.
   */
  it("shows what went back out, because the bank statement does", () => {
    const csv = toPaymentsCsv([payment("M-2", 10_000, 0, null, 10_000)]).split("\r\n");

    expect(csv[0]).toContain("Refunded");
    expect(csv[1]).toContain("$100.00");
    expect(csv.at(-1)).toContain("TOTAL");
  });

  // Blank rather than "$0.00", for the reconciliation column's reason: a zero in a money column
  // reads as a figure somebody entered, and most payments are never refunded at all.
  it("leaves the column blank when nothing was returned", () => {
    const cells = toPaymentsCsv([payment("B-207", 10_000, 299, null)]).split("\r\n")[1]?.split(",");
    expect(cells?.filter((cell) => cell === "")).not.toHaveLength(0);
  });

  it("says which rows are already matched, which is what the column exists for", () => {
    const csv = toPaymentsCsv([
      payment("A-114", 216_000, 0, new Date("2027-02-03T00:00:00Z")),
      payment("B-207", 10_000, 299, null),
    ]).split("\r\n");

    expect(csv[1]).toContain("2027-02-03");
    // An unreconciled payment is blank, not "false": the column is a date, because a timestamp
    // records an event and a boolean records a claim.
    expect(csv[2]?.endsWith(",")).toBe(true);
  });

  it("totals exactly the rows above it", () => {
    const lines = toPaymentsCsv([
      payment("A-114", 216_000, 0, null),
      payment("B-207", 10_000, 299, null),
    ]).split("\r\n");

    expect(lines.at(-1)).toContain("TOTAL");
    expect(lines.at(-1)).toContain("$2,260.00");
    expect(lines.at(-1)).toContain("$2.99");
    expect(lines.at(-1)).toContain("$2,257.01");
  });

  it("is a header and a total row when nothing has arrived", () => {
    const lines = toPaymentsCsv([]).split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("$0.00");
  });
});

describe("summarizeOpenPayments", () => {
  it("is nothing when every payment is fully attributed", () => {
    expect(summarizeOpenPayments([])).toEqual({ count: 0, totalRemainingCents: 0 });
  });

  it("adds up exactly the remainders it lists", () => {
    // NCSU's $560 leftover, a $100 deposit paid before acceptance, and $12.50 of odd change.
    const summary = summarizeOpenPayments([
      { remainingCents: 56_000 },
      { remainingCents: 10_000 },
      { remainingCents: 1_250 },
    ]);

    expect(summary).toEqual({ count: 3, totalRemainingCents: 67_250 });
  });

  /**
   * A fully attached payment is excluded rather than shown as $0 — the same rule `whoOwes` applies
   * to a team that was never billed. A list of things needing attention that contains things not
   * needing attention is a list a treasurer stops reading.
   */
  it("omits a settled payment instead of listing it at zero", () => {
    const summary = summarizeOpenPayments([{ remainingCents: 0 }, { remainingCents: 56_000 }]);
    expect(summary).toEqual({ count: 1, totalRemainingCents: 56_000 });
  });
});
