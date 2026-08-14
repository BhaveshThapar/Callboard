import { describe, expect, it } from "vitest";
import type { RosterTeamView } from "@/lib/auth/scope";
import type { WhoOwes, WhoOwesRow } from "@/lib/money/who-owes";
import { duesDedupeKey, planDuesReminders } from "../dues";

const CONTEXT = { compName: "Mayuri 2027", boardName: "Ananya Krishnan", period: "2027-02" };

const team = (
  id: string,
  name: string,
  contactPersonId: string | null,
  charges: { kind: string; amountCents: number; paidCents: number }[] = [],
): RosterTeamView => ({
  id,
  bidCode: id,
  name,
  school: null,
  performanceOrder: null,
  status: "accepted",
  waitlistRank: null,
  rosterSize: 20,
  rooms: 5,
  auditionUrl: null,
  musicUrl: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  materialsSubmittedAt: null,
  rosterSizeRequested: null,
  waiverAcceptedAt: null,
  contactName: contactPersonId ? "A Captain" : null,
  contactEmail: contactPersonId ? "captain@example.com" : null,
  contactPersonId,
  customAnswers: null,
  charges: charges.map((charge, i) => ({ id: `${id}-${i}`, ...charge })),
  balance: { owedCents: 0, paidCents: 0, balanceCents: 0 },
});

const owes = (teamId: string, name: string, balanceCents: number): WhoOwesRow => ({
  teamId,
  bidCode: teamId,
  name,
  school: null,
  status: "accepted",
  owedCents: balanceCents > 0 ? balanceCents : 0,
  paidCents: balanceCents < 0 ? -balanceCents : 0,
  balanceCents,
  gaps: [],
});

const report = (rows: WhoOwesRow[]): WhoOwes => ({
  rows,
  totals: { owedCents: 0, paidCents: 0, balanceCents: 0 },
  outstandingCount: rows.filter((r) => r.balanceCents > 0).length,
  settledCount: 0,
  creditCount: 0,
});

describe("planDuesReminders", () => {
  it("plans a reminder carrying the balance and the lines behind it", () => {
    const roster = [
      team("M-2", "NCSU Nazaare", "person-1", [
        { kind: "registration", amountCents: 140000, paidCents: 0 },
        { kind: "late_fee", amountCents: 2500, paidCents: 0 },
      ]),
    ];

    const plan = planDuesReminders(report([owes("M-2", "NCSU Nazaare", 142500)]), roster, CONTEXT);

    expect(plan.skipped).toEqual([]);
    expect(plan.send).toHaveLength(1);

    const [only] = plan.send;
    expect(only?.personId).toBe("person-1");
    expect(only?.payload.balance).toBe("$1,425.00");
    expect(only?.payload.compName).toBe("Mayuri 2027");
    expect(only?.payload.boardName).toBe("Ananya Krishnan");
    // The lines, not just a total: "what is this for" is answerable without a second email.
    expect(only?.payload.lines).toEqual([
      { kind: "registration", amount: "$1,400.00", paid: "$0.00" },
      { kind: "late fee", amount: "$25.00", paid: "$0.00" },
    ]);
  });

  it("states a team it cannot chase rather than quietly sending fewer", () => {
    const roster = [team("M-2", "Has A Captain", "person-1"), team("M-3", "No Captain", null)];

    const plan = planDuesReminders(
      report([owes("M-2", "Has A Captain", 1000), owes("M-3", "No Captain", 5000)]),
      roster,
      CONTEXT,
    );

    expect(plan.send.map((row) => row.teamId)).toEqual(["M-2"]);
    expect(plan.skipped).toEqual([
      { teamId: "M-3", teamName: "No Captain", reason: "no-contact" },
    ]);
  });

  it("chases nobody who is settled or in credit", () => {
    const roster = [
      team("M-2", "Settled", "person-1"),
      team("M-3", "Overpaid", "person-2"),
      team("M-4", "Owes", "person-3"),
    ];

    const plan = planDuesReminders(
      report([
        owes("M-2", "Settled", 0),
        owes("M-3", "Overpaid", -2500),
        owes("M-4", "Owes", 100),
      ]),
      roster,
      CONTEXT,
    );

    expect(plan.send.map((row) => row.teamId)).toEqual(["M-4"]);
    expect(plan.skipped).toEqual([]);
  });

  /**
   * A captain with no address on file is the engine's problem, not this function's. It enqueues, and
   * the sweep records `bounced` with the reason — which is a record a board can act on, where a
   * silent omission here would leave them believing everybody was chased.
   */
  it("still plans for a captain with no address, because the outbox records that better", () => {
    const roster = [team("M-2", "Nameless Inbox", "person-1")];
    roster[0]!.contactEmail = null;

    const plan = planDuesReminders(report([owes("M-2", "Nameless Inbox", 1000)]), roster, CONTEXT);

    expect(plan.send).toHaveLength(1);
    expect(plan.skipped).toEqual([]);
  });

  it("gives one key per team per period, so a second click sends nothing", () => {
    const roster = [team("M-2", "A", "person-1"), team("M-3", "B", "person-2")];
    const rows = [owes("M-2", "A", 100), owes("M-3", "B", 100)];

    const first = planDuesReminders(report(rows), roster, CONTEXT);
    const again = planDuesReminders(report(rows), roster, CONTEXT);

    expect(first.send.map((r) => r.dedupeKey)).toEqual(again.send.map((r) => r.dedupeKey));
    expect(new Set(first.send.map((r) => r.dedupeKey)).size).toBe(2);
  });

  it("makes the next period a different key, so a monthly chase is not refused forever", () => {
    expect(duesDedupeKey("M-2", "2027-02")).not.toBe(duesDedupeKey("M-2", "2027-03"));
    expect(duesDedupeKey("M-2", "2027-02")).toBe(duesDedupeKey("M-2", "2027-02"));
  });

  it("ignores a report row for a team that is not on the roster handed in", () => {
    const plan = planDuesReminders(report([owes("GHOST", "Withdrawn", 5000)]), [], CONTEXT);

    expect(plan.send).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  /**
   * The case that made A10 decorative for exactly the boards it was built for.
   *
   * `teams.contact_person_id` is written by the registration form, and setup is founder-run by
   * design (PRD §12) — so a founding partner's roster is *seeded*, has no contact on any team, and
   * every team fell into `no-contact`. A captain who accepted an invitation is the same human by a
   * different door, and P1 built that door; the caller resolves it and passes it in, because doing
   * so needs a second table and this function must not touch one.
   */
  it("reaches a captain who accepted an invitation when nobody registered the team", () => {
    const roster = [
      team("M-2", "Seeded Team", null, [
        { kind: "registration", amountCents: 220_000, paidCents: 0 },
      ]),
    ];
    const owed = report([owes("M-2", "Seeded Team", 220_000)]);

    const without = planDuesReminders(owed, roster, CONTEXT);
    expect(without.send).toHaveLength(0);
    expect(without.skipped[0]?.reason).toBe("no-contact");

    const withCaptain = planDuesReminders(owed, roster, {
      ...CONTEXT,
      contactFor: new Map([["M-2", "person-captain"]]),
    });
    expect(withCaptain.skipped).toHaveLength(0);
    expect(withCaptain.send[0]?.personId).toBe("person-captain");
  });

  /** A registered contact wins: the person who filled in the form said they were the contact. */
  it("prefers the registered contact over a captain membership", () => {
    const roster = [
      team("M-2", "Registered Team", "person-registered", [
        { kind: "registration", amountCents: 220_000, paidCents: 0 },
      ]),
    ];
    const plan = planDuesReminders(report([owes("M-2", "Registered Team", 220_000)]), roster, {
      ...CONTEXT,
      contactFor: new Map([["M-2", "person-captain"]]),
    });
    expect(plan.send[0]?.personId).toBe("person-registered");
  });
});
