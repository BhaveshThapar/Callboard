import { describe, expect, it } from "vitest";
import type { BoardLinkRow } from "../links";
import { boardLinks, refuseRevoke } from "../links";

const roster: BoardLinkRow[] = [
  { assignmentId: "a-1", name: "Ananya Krishnan", revokedAt: null },
  { assignmentId: "r-2", name: "Rohit Iyer", revokedAt: null },
  { assignmentId: "d-3", name: "Dev Sharma", revokedAt: new Date("2026-07-11T00:00:00Z") },
];

const links = boardLinks(roster, "a-1");

describe("boardLinks", () => {
  it("narrows the revocation timestamp to a boolean the client can trust", () => {
    expect(links.map((l) => l.revoked)).toEqual([false, false, true]);
  });

  // Nothing makes `(comp_id, person_id)` unique, and what is revoked is a link, not a human. Keying
  // `isSelf` on the person would hide the revoke control on someone else's second link.
  it("keys isSelf on the assignment, not the person", () => {
    const twoLinks = boardLinks(
      [
        { assignmentId: "a-1", name: "Ananya Krishnan", revokedAt: null },
        { assignmentId: "a-2", name: "Ananya Krishnan", revokedAt: null },
      ],
      "a-1",
    );
    expect(twoLinks.map((l) => l.isSelf)).toEqual([true, false]);
  });
});

describe("refuseRevoke", () => {
  it("permits revoking another board member's live link", () => {
    expect(refuseRevoke(links, "r-2")).toBeNull();
  });

  // The guard that keeps a comp administrable. To revoke you must hold a live link, so if the target
  // is never you there were >= 2 live links before and >= 1 after.
  it("refuses self-revoke, and says why there is no way back", () => {
    const refusal = refuseRevoke(links, "a-1");
    expect(refusal).toMatch(/cannot revoke your own link/);
    expect(refusal).toMatch(/nothing re-issues a board link/i);
  });

  it("refuses a link that is already revoked", () => {
    expect(refuseRevoke(links, "d-3")).toMatch(/already revoked/);
  });

  // An assignmentId on a form is a claim, not a fact: it is checked against the scoped read that
  // produced the form. This is also what stops a crafted id reaching Postgres as a bad uuid.
  it("refuses an id that is not on this comp", () => {
    expect(refuseRevoke(links, "someone-elses-comp")).toMatch(/not on this comp/);
    expect(refuseRevoke(links, "")).toMatch(/Pick a board member/);
  });
});
