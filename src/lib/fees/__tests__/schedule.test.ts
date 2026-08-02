import { describe, expect, it } from "vitest";
import { generateCharges, planCharges, totalCents } from "../schedule";
import type { ExistingCharge, FeeSchedule } from "../types";

/** Mayuri 2026: $70/dancer + $140/room + $100 deposit, late fees after Feb 1. */
const MAYURI: FeeSchedule = {
  perDancerCents: 7000,
  perRoomCents: 14000,
  depositCents: 10000,
  lateFeeCents: 2500,
  lateAfter: "2027-02-01",
};

const team = (teamId: string, rosterSize: number | null, rooms: number | null) => ({
  teamId,
  rosterSize,
  rooms,
});

describe("generateCharges", () => {
  it("bills every team a different total, which is the normal case", () => {
    const { lines, gaps } = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 16, 4), team("b", 23, 6)],
      asOf: "2027-01-15",
    });

    expect(gaps).toEqual([]);
    expect(totalCents(lines.filter((l) => l.teamId === "a"))).toBe(7000 * 16 + 14000 * 4 + 10000);
    expect(totalCents(lines.filter((l) => l.teamId === "b"))).toBe(7000 * 23 + 14000 * 6 + 10000);
  });

  it("states a gap instead of billing $0 when a room count is unknown", () => {
    const { lines, gaps } = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 16, null)],
      asOf: "2027-01-15",
    });

    // The point of the whole thing: no hotel line at all, and a stated reason why.
    expect(lines.map((l) => l.kind)).toEqual(["registration", "deposit"]);
    expect(gaps).toEqual([{ teamId: "a", kind: "hotel", missing: "rooms" }]);
  });

  it("states a gap for an unknown roster size too", () => {
    const { lines, gaps } = generateCharges({
      schedule: MAYURI,
      teams: [team("a", null, 4)],
      asOf: "2027-01-15",
    });

    expect(lines.map((l) => l.kind)).toEqual(["hotel", "deposit"]);
    expect(gaps).toEqual([{ teamId: "a", kind: "registration", missing: "rosterSize" }]);
  });

  it("distinguishes a schedule that is silent from one that is generous", () => {
    const noDeposit: FeeSchedule = { ...MAYURI, depositCents: 0, perRoomCents: 0 };
    const { lines } = generateCharges({
      schedule: noDeposit,
      teams: [team("a", 16, 4)],
      asOf: "2027-01-15",
    });

    // A $0 deposit line would claim the comp charges a deposit. It does not.
    expect(lines.map((l) => l.kind)).toEqual(["registration"]);
  });

  it("bills zero dancers as no line rather than a zero line", () => {
    const { lines, gaps } = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 0, 0)],
      asOf: "2027-01-15",
    });

    expect(lines.map((l) => l.kind)).toEqual(["deposit"]);
    expect(gaps).toEqual([]);
  });

  it("applies the late fee strictly after the date, not on it", () => {
    const on = generateCharges({ schedule: MAYURI, teams: [team("a", 1, 0)], asOf: "2027-02-01" });
    const after = generateCharges({ schedule: MAYURI, teams: [team("a", 1, 0)], asOf: "2027-02-02" });

    expect(on.lines.some((l) => l.kind === "late_fee")).toBe(false);
    expect(after.lines.some((l) => l.kind === "late_fee")).toBe(true);
  });

  it("charges no late fee when the comp declares none", () => {
    const noLate: FeeSchedule = { ...MAYURI, lateFeeCents: 0, lateAfter: null };
    const { lines } = generateCharges({
      schedule: noLate,
      teams: [team("a", 1, 0)],
      asOf: "2099-01-01",
    });

    expect(lines.some((l) => l.kind === "late_fee")).toBe(false);
  });

  it("is a function of asOf, not of when it ran", () => {
    const input = { schedule: MAYURI, teams: [team("a", 16, 4)], asOf: "2027-03-01" } as const;
    expect(generateCharges(input)).toEqual(generateCharges(input));
  });
});

describe("planCharges", () => {
  const existing = (id: string, teamId: string, kind: ExistingCharge["kind"], amountCents: number) => ({
    id,
    teamId,
    kind,
    amountCents,
  });

  it("regenerating with no roster change is a no-op — the whole idempotency claim", () => {
    const { lines } = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 16, 4)],
      asOf: "2027-01-15",
    });
    const current = lines.map((line, i) => ({ id: `c${i}`, ...line }));

    const plan = planCharges(lines, current);

    expect(plan.insert).toEqual([]);
    expect(plan.void).toEqual([]);
    expect(plan.unchanged).toHaveLength(lines.length);
  });

  it("a changed amount voids the old and inserts the new, never updates", () => {
    const plan = planCharges(
      [{ teamId: "a", kind: "registration", amountCents: 16100 }],
      [existing("c1", "a", "registration", 11200)],
    );

    // An update would silently re-point the allocations already made against the old amount.
    expect(plan.void).toEqual([existing("c1", "a", "registration", 11200)]);
    expect(plan.insert).toEqual([{ teamId: "a", kind: "registration", amountCents: 16100 }]);
    expect(plan.unchanged).toEqual([]);
  });

  it("voids what the schedule no longer says — the anti-orphan rule a drop triggers", () => {
    const plan = planCharges([], [existing("c1", "a", "registration", 11200), existing("c2", "a", "deposit", 10000)]);

    expect(plan.insert).toEqual([]);
    expect(plan.void).toHaveLength(2);
  });

  it("never resurrects a voided charge: it is absent from existing, so the insert stands", () => {
    // A team that paid, dropped and came back. Its old charges were voided, so they are not in
    // `existing`; the new ones insert cleanly, and the old allocations still count as paid.
    const plan = planCharges([{ teamId: "a", kind: "deposit", amountCents: 10000 }], []);

    expect(plan.insert).toEqual([{ teamId: "a", kind: "deposit", amountCents: 10000 }]);
    expect(plan.void).toEqual([]);
  });

  it("keys identity on (teamId, kind), matching charges_live_kind_unique", () => {
    const plan = planCharges(
      [
        { teamId: "a", kind: "deposit", amountCents: 10000 },
        { teamId: "b", kind: "deposit", amountCents: 10000 },
      ],
      [existing("c1", "a", "deposit", 10000)],
    );

    expect(plan.unchanged.map((c) => c.id)).toEqual(["c1"]);
    expect(plan.insert).toEqual([{ teamId: "b", kind: "deposit", amountCents: 10000 }]);
  });

  it("fills a gap by inserting the line it withheld, and touches nothing else", () => {
    // The 2.1 path: a team applied without a room count, was billed for everything else, and the
    // board has now been given a way to say "four rooms". The hotel line has to appear without
    // voiding and re-inserting the registration and deposit charges the team may already have paid
    // against — a void would release those allocations for no reason.
    const before = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 16, null)],
      asOf: "2027-01-15",
    });
    const applied = before.lines.map((line, i) => ({ id: `c${i}`, ...line }));

    const after = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 16, 4)],
      asOf: "2027-01-15",
    });
    const plan = planCharges(after.lines, applied);

    expect(plan.insert).toEqual([{ teamId: "a", kind: "hotel", amountCents: 14000 * 4 }]);
    expect(plan.void).toEqual([]);
    expect(plan.unchanged).toHaveLength(2);
  });

  it("a corrected roster size re-bills registration and leaves the deposit alone", () => {
    // Roster churn between acceptance and the show: two dancers drop. Only the line whose amount
    // moved is voided, so the deposit's allocations survive a correction that has nothing to do
    // with them.
    const before = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 16, 4)],
      asOf: "2027-01-15",
    });
    const applied = before.lines.map((line, i) => ({ id: `c${i}`, ...line }));

    const after = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 14, 4)],
      asOf: "2027-01-15",
    });
    const plan = planCharges(after.lines, applied);

    expect(plan.void.map((c) => c.kind)).toEqual(["registration"]);
    expect(plan.insert).toEqual([
      { teamId: "a", kind: "registration", amountCents: 7000 * 14 },
    ]);
    expect(plan.unchanged.map((c) => c.kind).sort()).toEqual(["deposit", "hotel"]);
  });

  it("a regeneration after the late date adds one late fee, and a second adds none", () => {
    // The 2.2 path, and the reason the button exists: nothing regenerated charges once a team's
    // status had settled, so a late fee whose date passed was never billed to anybody.
    const december = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 16, 4)],
      asOf: "2026-12-01",
    });
    const applied = december.lines.map((line, i) => ({ id: `c${i}`, ...line }));
    expect(applied.some((c) => c.kind === "late_fee")).toBe(false);

    const february = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 16, 4)],
      asOf: "2027-02-15",
    });
    const first = planCharges(february.lines, applied);

    expect(first.insert).toEqual([{ teamId: "a", kind: "late_fee", amountCents: 2500 }]);
    expect(first.void).toEqual([]);

    // Clicking it twice is the realistic thing a board does, so the no-op is the property that
    // matters more than the insert.
    const second = planCharges(february.lines, [
      ...applied,
      { id: "late", teamId: "a", kind: "late_fee" as const, amountCents: 2500 },
    ]);
    expect(second.insert).toEqual([]);
    expect(second.void).toEqual([]);
  });

  it("is idempotent across two rounds: applying the plan then replanning changes nothing", () => {
    const first = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 16, 4), team("b", 20, null)],
      asOf: "2027-01-15",
    });
    const applied = first.lines.map((line, i) => ({ id: `c${i}`, ...line }));

    const second = generateCharges({
      schedule: MAYURI,
      teams: [team("a", 16, 4), team("b", 20, null)],
      asOf: "2027-01-15",
    });
    const plan = planCharges(second.lines, applied);

    expect(plan).toEqual({ insert: [], void: [], unchanged: applied });
  });
});

describe("totalCents", () => {
  it("stays in integer cents through the $97.01 case", () => {
    // gross 10000 = net 9701 + fee 299. No float anywhere near it.
    expect(totalCents([{ amountCents: 9701 }, { amountCents: 299 }])).toBe(10000);
  });

  it("is 0 for nothing", () => {
    expect(totalCents([])).toBe(0);
  });
});
