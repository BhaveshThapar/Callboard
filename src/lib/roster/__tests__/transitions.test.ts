import { describe, expect, it } from "vitest";
import { SCOREABLE_STATUSES, type TeamStatus } from "@/db/schema";
import {
  allowedFrom,
  canTransition,
  dropFreesASlot,
  nextOffWaitlist,
  nextWaitlistRank,
  reorderWaitlist,
  type WaitlistEntry,
} from "../transitions";

const ALL: TeamStatus[] = ["applied", "waitlisted", "accepted", "dropped", "competing"];

/** The queue as a board reads it: ids in promotion order, which is the only thing a reorder moves. */
const queue = (entries: readonly WaitlistEntry[]): string[] => {
  const remaining = [...entries];
  const order: string[] = [];

  while (remaining.length > 0) {
    const next = nextOffWaitlist(remaining)!;
    order.push(next);
    remaining.splice(
      remaining.findIndex((t) => t.id === next),
      1,
    );
  }

  return order;
};

/** Applies a rewrite set the way the `case` expression in `setWaitlistRank` does. */
const applied = (
  entries: readonly WaitlistEntry[],
  rewrites: readonly { id: string; waitlistRank: number }[],
): WaitlistEntry[] =>
  entries.map((entry) => {
    const rewrite = rewrites.find((r) => r.id === entry.id);
    return rewrite ? { ...entry, waitlistRank: rewrite.waitlistRank } : entry;
  });

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

describe("nextWaitlistRank", () => {
  it("starts at 1 on an empty waitlist", () => {
    expect(nextWaitlistRank([])).toBe(1);
  });

  it("appends past the highest rank, so a joiner never jumps the queue", () => {
    expect(nextWaitlistRank([1, 2, 3])).toBe(4);
  });

  // Ranks are not re-normalized when a team is promoted or dropped, so the list a board is
  // actually holding has gaps in it. Appending past the maximum is what keeps arrival order
  // intact through those gaps; appending past the *count* would reissue a rank still in use.
  it("appends past the maximum, not the count, when the list has gaps", () => {
    expect(nextWaitlistRank([2, 5])).toBe(6);
  });

  it("ignores unranked rows rather than counting them", () => {
    expect(nextWaitlistRank([null, 3, null])).toBe(4);
    expect(nextWaitlistRank([null, null])).toBe(1);
  });

  // The rank it hands out has to be one `nextOffWaitlist` will put last, or appending is a lie.
  it("hands out a rank that sorts behind everyone already waiting", () => {
    const waiting = [
      { id: "first", waitlistRank: 1 },
      { id: "second", waitlistRank: 2 },
    ];
    const joined = [...waiting, { id: "third", waitlistRank: nextWaitlistRank([1, 2]) }];

    expect(nextOffWaitlist(joined)).toBe("first");
    expect(nextOffWaitlist(joined.filter((t) => t.id !== "first"))).toBe("second");
    expect(nextOffWaitlist(joined.filter((t) => t.id === "third"))).toBe("third");
  });
});

describe("reorderWaitlist", () => {
  const three: WaitlistEntry[] = [
    { id: "a", waitlistRank: 1 },
    { id: "b", waitlistRank: 2 },
    { id: "c", waitlistRank: 3 },
  ];

  it("moves a team up one place", () => {
    const moved = applied(three, reorderWaitlist(three, "c", "up"));
    expect(queue(moved)).toEqual(["a", "c", "b"]);
  });

  it("moves a team down one place", () => {
    const moved = applied(three, reorderWaitlist(three, "a", "down"));
    expect(queue(moved)).toEqual(["b", "a", "c"]);
  });

  it("refuses to move past either end rather than wrapping or renumbering", () => {
    expect(reorderWaitlist(three, "a", "up")).toEqual([]);
    expect(reorderWaitlist(three, "c", "down")).toEqual([]);
  });

  it("refuses a team that is not on the waitlist at all", () => {
    expect(reorderWaitlist(three, "not-here", "up")).toEqual([]);
  });

  // The whole point of the trade: the set of ranks on the comp is unchanged, so nobody outside the
  // pair is renumbered and the gaps a promotion left behind survive the reorder.
  it("trades two ranks and touches nothing else", () => {
    const rewrites = reorderWaitlist(three, "c", "up");

    expect(rewrites).toHaveLength(2);
    expect(rewrites.map((r) => r.id).sort()).toEqual(["b", "c"]);

    const before = three.map((t) => t.waitlistRank).sort();
    const after = applied(three, rewrites)
      .map((t) => t.waitlistRank)
      .sort();
    expect(after).toEqual(before);
  });

  it("keeps the gaps a promotion left behind", () => {
    const gapped: WaitlistEntry[] = [
      { id: "a", waitlistRank: 1 },
      { id: "b", waitlistRank: 4 },
      { id: "c", waitlistRank: 9 },
    ];
    const moved = applied(gapped, reorderWaitlist(gapped, "c", "up"));

    expect(queue(moved)).toEqual(["a", "c", "b"]);
    expect(moved.map((t) => t.waitlistRank).sort((x, y) => x! - y!)).toEqual([1, 4, 9]);
  });

  // Two board members waitlisting in the same second share a rank, which `appendToWaitlist`
  // tolerates on purpose. There is no second number to trade, so this is the one path that
  // renumbers -- and it must still leave the team ahead of the pair where it was.
  it("re-spaces a tie instead of trading, without disturbing the team ahead of it", () => {
    const tied: WaitlistEntry[] = [
      { id: "a", waitlistRank: 1 },
      { id: "b", waitlistRank: 4 },
      { id: "c", waitlistRank: 4 },
    ];
    const rewrites = reorderWaitlist(tied, "c", "up");

    expect(rewrites.map((r) => r.id)).not.toContain("a");
    expect(queue(applied(tied, rewrites))).toEqual(["a", "c", "b"]);
  });

  it("gives an unranked team a real rank the first time it is moved", () => {
    const partly: WaitlistEntry[] = [
      { id: "a", waitlistRank: 1 },
      { id: "b", waitlistRank: 2 },
      { id: "unranked", waitlistRank: null },
    ];
    const moved = applied(partly, reorderWaitlist(partly, "unranked", "up"));

    expect(queue(moved)).toEqual(["a", "unranked", "b"]);
    expect(moved.find((t) => t.id === "unranked")?.waitlistRank).not.toBeNull();
  });

  it("is its own inverse: up then down puts the queue back", () => {
    const up = applied(three, reorderWaitlist(three, "c", "up"));
    const back = applied(up, reorderWaitlist(up, "c", "down"));

    expect(queue(back)).toEqual(["a", "b", "c"]);
  });

  // A rank a board can see but a promotion ignores would be a lie on the screen. Every rewrite has
  // to leave the list in a state `nextOffWaitlist` reads the same way the board just arranged it.
  it("walks a team from the back of the queue to the front, one place at a time", () => {
    let list: WaitlistEntry[] = [
      { id: "a", waitlistRank: 1 },
      { id: "b", waitlistRank: 2 },
      { id: "c", waitlistRank: 5 },
      { id: "d", waitlistRank: 6 },
    ];

    for (let step = 0; step < 3; step++) list = applied(list, reorderWaitlist(list, "d", "up"));

    expect(queue(list)).toEqual(["d", "a", "b", "c"]);
    expect(nextOffWaitlist(list)).toBe("d");
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
