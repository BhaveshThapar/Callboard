import { describe, expect, it } from "vitest";
import { SCOREABLE_STATUSES, type TeamStatus } from "@/db/schema";
import { allowedFrom, canTransition, dropFreesASlot, nextOffWaitlist } from "../transitions";

const ALL: TeamStatus[] = ["applied", "waitlisted", "accepted", "dropped", "competing"];

describe("canTransition", () => {
  it("walks the ordinary path: applied -> accepted -> competing", () => {
    expect(canTransition("applied", "accepted")).toBe(true);
    expect(canTransition("accepted", "competing")).toBe(true);
  });

  it("lets an applied team be waitlisted, and a waitlisted team be accepted", () => {
    expect(canTransition("applied", "waitlisted")).toBe(true);
    expect(canTransition("waitlisted", "accepted")).toBe(true);
  });

  it("lets a dropped team be reinstated, because registration churn runs for months", () => {
    expect(canTransition("dropped", "accepted")).toBe(true);
    expect(canTransition("dropped", "waitlisted")).toBe(true);
  });

  it("refuses to un-compete a team, or to demote an accepted one back to applied", () => {
    expect(canTransition("competing", "accepted")).toBe(false);
    expect(canTransition("accepted", "applied")).toBe(false);
    expect(canTransition("waitlisted", "applied")).toBe(false);
  });

  it("refuses a transition to itself, so a no-op cannot masquerade as a change in the audit log", () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("is total: every status has an answer, and none can reach a status outside the union", () => {
    for (const from of ALL) {
      expect(allowedFrom(from)).toBeDefined();
      for (const to of allowedFrom(from)) {
        expect(ALL).toContain(to);
      }
    }
  });

  // The reason `dropped` is allowed to be reinstated at all is that the lock closes the door first.
  // If this ever becomes reachable after a lock, a dropped team gets its old scores back.
  it("can always reach dropped from a scoreable status, so a slot can always be freed", () => {
    for (const status of SCOREABLE_STATUSES) {
      expect(canTransition(status, "dropped")).toBe(true);
    }
  });
});

describe("nextOffWaitlist", () => {
  it("takes the lowest rank", () => {
    expect(
      nextOffWaitlist([
        { id: "b", waitlistRank: 2 },
        { id: "a", waitlistRank: 1 },
        { id: "c", waitlistRank: 3 },
      ]),
    ).toBe("a");
  });

  it("never lets an unranked team jump a ranked one", () => {
    expect(
      nextOffWaitlist([
        { id: "unranked", waitlistRank: null },
        { id: "ranked", waitlistRank: 9 },
      ]),
    ).toBe("ranked");
  });

  it("breaks ties by id, so a promotion does not depend on row order Postgres never promised", () => {
    const entries = [
      { id: "zeta", waitlistRank: 1 },
      { id: "alpha", waitlistRank: 1 },
    ];
    expect(nextOffWaitlist(entries)).toBe("alpha");
    expect(nextOffWaitlist([...entries].reverse())).toBe("alpha");
  });

  it("is deterministic when nothing is ranked at all", () => {
    const entries = [
      { id: "b", waitlistRank: null },
      { id: "a", waitlistRank: null },
    ];
    expect(nextOffWaitlist(entries)).toBe("a");
    expect(nextOffWaitlist([...entries].reverse())).toBe("a");
  });

  it("returns null on an empty waitlist rather than inventing a promotion", () => {
    expect(nextOffWaitlist([])).toBeNull();
  });
});

describe("dropFreesASlot", () => {
  it("frees a slot only for a team that held one", () => {
    expect(dropFreesASlot("accepted")).toBe(true);
    expect(dropFreesASlot("competing")).toBe(true);
    expect(dropFreesASlot("applied")).toBe(false);
    expect(dropFreesASlot("waitlisted")).toBe(false);
  });

  // The two must agree, or a team that places is not a team that holds a slot.
  it("frees a slot for exactly the scoreable statuses", () => {
    for (const status of ALL) {
      expect(dropFreesASlot(status)).toBe(
        (SCOREABLE_STATUSES as readonly TeamStatus[]).includes(status),
      );
    }
  });
});
