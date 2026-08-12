import { describe, expect, it } from "vitest";
import type { RosterTeamView } from "@/lib/auth/scope";
import { contactPersonFor } from "../contact";
import {
  depositReturnedDedupeKey,
  planDepositReturned,
  planPaymentReceipt,
  receiptDedupeKey,
} from "../receipts";

const team = (
  id: string,
  contactPersonId: string | null,
  balanceCents: number,
): RosterTeamView => ({
  id,
  bidCode: id,
  name: "NCSU Nazaare",
  school: null,
  performanceOrder: null,
  status: "accepted",
  waitlistRank: null,
  rosterSize: 20,
  rooms: 5,
  auditionUrl: null,
  waiverAcceptedAt: null,
  contactName: null,
  contactEmail: null,
  contactPersonId,
  customAnswers: null,
  charges: [],
  balance: { owedCents: 220_000, paidCents: 220_000 - balanceCents, balanceCents },
});

const PAYMENT = { id: "pay-1", grossCents: 216_000, feeCents: 299, rail: "venmo" };

describe("planPaymentReceipt", () => {
  it("tells a team what arrived, what it cost, and what is left", () => {
    const plan = planPaymentReceipt(team("M-2", "person-1", 4_000), new Map(), PAYMENT, {
      compName: "Mayuri 2027",
    });

    expect(plan?.personId).toBe("person-1");
    expect(plan?.payload).toEqual({
      teamName: "NCSU Nazaare",
      compName: "Mayuri 2027",
      gross: "$2,160.00",
      // The three integers, because `payments` holds three: a fee is a recorded cost, not a hole,
      // and the team is credited the gross rather than the net.
      fee: "$2.99",
      net: "$2,157.01",
      rail: "venmo",
      balance: "$40.00",
    });
  });

  it("keys on the payment, so a retried submit receipts once", () => {
    expect(receiptDedupeKey("pay-1")).toBe(receiptDedupeKey("pay-1"));
    expect(receiptDedupeKey("pay-1")).not.toBe(receiptDedupeKey("pay-2"));
  });

  it("reaches a captain who accepted an invitation when nothing was registered", () => {
    const plan = planPaymentReceipt(
      team("M-2", null, 0),
      new Map([["M-2", "person-captain"]]),
      PAYMENT,
      { compName: "Mayuri 2027" },
    );

    expect(plan?.personId).toBe("person-captain");
  });

  it("is null when there is nobody to receipt, so the caller can say so", () => {
    expect(planPaymentReceipt(team("M-2", null, 0), new Map(), PAYMENT, { compName: "C" })).toBeNull();
  });

  /** A settled team still gets a receipt — "you are square" is the most useful one there is. */
  it("receipts a payment that settles the balance", () => {
    const plan = planPaymentReceipt(team("M-2", "person-1", 0), new Map(), PAYMENT, {
      compName: "Mayuri 2027",
    });

    expect(plan?.payload.balance).toBe("$0.00");
  });
});

describe("planDepositReturned", () => {
  /**
   * The number that must not move. `refunded` voids the obligation *and* releases its allocations,
   * so `owed` and `paid` fall together (ADR-0015) — and saying the balance out loud is what stops a
   * captain reading a returned deposit as a fresh bill.
   */
  it("says what went back and that the balance did not move", () => {
    const plan = planDepositReturned(
      team("M-2", "person-1", 4_000),
      new Map(),
      { amountCents: 10_000 },
      { compName: "Mayuri 2027", boardName: "Ananya Krishnan" },
    );

    expect(plan?.personId).toBe("person-1");
    expect(plan?.payload).toEqual({
      teamName: "NCSU Nazaare",
      compName: "Mayuri 2027",
      amount: "$100.00",
      balance: "$40.00",
      boardName: "Ananya Krishnan",
    });
  });

  /** A deposit ends once, so the key restates a database guarantee rather than choosing a policy. */
  it("keys on the team, because a deposit has exactly one ending", () => {
    expect(depositReturnedDedupeKey("M-2")).toBe(depositReturnedDedupeKey("M-2"));
    expect(depositReturnedDedupeKey("M-2")).not.toBe(depositReturnedDedupeKey("M-3"));
  });

  it("is null when there is nobody to tell", () => {
    expect(
      planDepositReturned(team("M-2", null, 0), new Map(), { amountCents: 10_000 }, {
        compName: "C",
        boardName: "B",
      }),
    ).toBeNull();
  });
});

/**
 * One definition, because there are two callers. Two copies would let a board be chased at one
 * address and receipted at another — a bug nobody reports and everybody distrusts.
 */
describe("contactPersonFor", () => {
  it("prefers the person who filled in the registration form", () => {
    expect(
      contactPersonFor(
        { id: "M-2", contactPersonId: "registered" },
        new Map([["M-2", "captain"]]),
      ),
    ).toBe("registered");
  });

  it("falls back to a captain's membership, which is all a seeded roster has", () => {
    expect(
      contactPersonFor({ id: "M-2", contactPersonId: null }, new Map([["M-2", "captain"]])),
    ).toBe("captain");
  });

  it("is null when neither door was opened", () => {
    expect(contactPersonFor({ id: "M-2", contactPersonId: null }, new Map())).toBeNull();
  });

  it("does not borrow another team's captain", () => {
    expect(
      contactPersonFor({ id: "M-2", contactPersonId: null }, new Map([["M-3", "captain"]])),
    ).toBeNull();
  });
});
