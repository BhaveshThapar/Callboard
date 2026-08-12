import { describe, expect, it } from "vitest";
import { ANNOUNCEABLE_STATUSES, BILLABLE_STATUSES, SCOREABLE_STATUSES } from "@/db/schema/teams";
import type { RosterTeamView } from "@/lib/auth/scope";
import type { TeamStatus } from "@/db/schema";
import { announcementDedupeKey, planAnnouncement } from "../announce";

const team = (id: string, status: TeamStatus, contactPersonId: string | null): RosterTeamView => ({
  id,
  bidCode: id,
  name: `Team ${id}`,
  school: null,
  performanceOrder: null,
  status,
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
  balance: { owedCents: 0, paidCents: 0, balanceCents: 0 },
});

const CONTENT = {
  compName: "Mayuri 2027",
  boardName: "Ananya Krishnan",
  subject: "Load-in moved to 7:30",
  body: "Doors at 7:30, not 8. Park in Lot 4.",
  baseUrl: "https://callboard.example",
};

describe("planAnnouncement", () => {
  it("reaches the teams that are in, and nobody else", () => {
    const roster = [
      team("M-1", "applied", "p1"),
      team("M-2", "waitlisted", "p2"),
      team("M-3", "accepted", "p3"),
      team("M-4", "competing", "p4"),
      team("M-5", "dropped", "p5"),
    ];

    const plan = planAnnouncement(roster, new Map(), CONTENT);

    // Not the waitlist, which has not been told it is coming — and above all not the team that
    // dropped, which is the kind of message a board never lives down.
    expect(plan.send.map((row) => row.teamId)).toEqual(["M-3", "M-4"]);
    expect(plan.skipped).toEqual([]);
  });

  it("carries the board's words unchanged, signed by a person", () => {
    const plan = planAnnouncement([team("M-3", "competing", "p3")], new Map(), CONTENT);

    expect(plan.send[0]?.payload).toEqual({
      compName: "Mayuri 2027",
      subject: "Load-in moved to 7:30",
      body: "Doors at 7:30, not 8. Park in Lot 4.",
      boardName: "Ananya Krishnan",
      unsubscribeUrl: "https://callboard.example/unsubscribe/p3",
    });
  });

  /**
   * The opt-out is addressed to the **person**, not the team, because `unsubscribed_at` is on
   * `people` and is org-wide: somebody who captains two teams at one org opted out once.
   */
  it("addresses the opt-out to whoever is actually being written to", () => {
    const plan = planAnnouncement(
      [team("M-3", "competing", null)],
      new Map([["M-3", "person-captain"]]),
      CONTENT,
    );

    expect(plan.send[0]?.payload.unsubscribeUrl).toBe(
      "https://callboard.example/unsubscribe/person-captain",
    );
  });

  /**
   * A deployment with no base URL cannot form a link, and the announcement then visibly lacks its
   * opt-out line. That is the point: it used to be a header that silently did not get set, which is
   * indistinguishable from a working one until somebody wants out.
   */
  it("carries no link rather than a broken one when there is no base URL", () => {
    const plan = planAnnouncement([team("M-3", "competing", "p3")], new Map(), {
      ...CONTENT,
      baseUrl: "",
    });

    expect(plan.send[0]?.payload.unsubscribeUrl).toBeNull();
  });

  it("names a team it cannot reach rather than quietly telling fewer people", () => {
    const roster = [team("M-3", "competing", "p3"), team("M-4", "competing", null)];
    const plan = planAnnouncement(roster, new Map(), CONTENT);

    expect(plan.send.map((row) => row.teamId)).toEqual(["M-3"]);
    expect(plan.skipped).toEqual([{ teamId: "M-4", teamName: "Team M-4", reason: "no-contact" }]);
  });

  it("reaches a captain who accepted an invitation on a seeded roster", () => {
    const plan = planAnnouncement(
      [team("M-3", "competing", null)],
      new Map([["M-3", "person-captain"]]),
      CONTENT,
    );

    expect(plan.send[0]?.personId).toBe("person-captain");
  });
});

describe("announcementDedupeKey", () => {
  it("is the same message to the same team, so a double-click sends once", () => {
    expect(announcementDedupeKey("M-3", "a", "b")).toBe(announcementDedupeKey("M-3", "a", "b"));
  });

  it("changes when any word does, so the next announcement is not refused as a repeat", () => {
    const base = announcementDedupeKey("M-3", "a", "b");
    expect(announcementDedupeKey("M-3", "a", "b!")).not.toBe(base);
    expect(announcementDedupeKey("M-3", "a!", "b")).not.toBe(base);
    expect(announcementDedupeKey("M-4", "a", "b")).not.toBe(base);
  });

  /** Subject and body are joined, not concatenated — or moving a word across the seam would collide. */
  it("does not collide when a word moves between subject and body", () => {
    expect(announcementDedupeKey("M-3", "ab", "c")).not.toBe(announcementDedupeKey("M-3", "a", "bc"));
  });
});

/**
 * Three lists, three questions, and the day one of them moves is the day sharing a constant becomes
 * a silent bug in the other two. They are equal today, which is exactly when the mistake is easy.
 */
describe("the status lists", () => {
  it("agree today without being the same list", () => {
    expect([...ANNOUNCEABLE_STATUSES]).toEqual([...BILLABLE_STATUSES]);
    expect([...ANNOUNCEABLE_STATUSES]).toEqual([...SCOREABLE_STATUSES]);
  });

  it("never announce to a team that dropped or is still waiting", () => {
    const announceable: readonly string[] = ANNOUNCEABLE_STATUSES;
    expect(announceable).not.toContain("dropped");
    expect(announceable).not.toContain("waitlisted");
    expect(announceable).not.toContain("applied");
  });
});
