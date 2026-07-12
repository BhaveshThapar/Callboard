import { describe, expect, it } from "vitest";
import type { Observed } from "../health";
import { summarizeHealth } from "../health";

const healthy: Observed = {
  compFound: true,
  boardAssignments: 2,
  boardName: "Ananya Krishnan",
  boardViewLoaded: true,
  judges: 3,
  judgeViewLoaded: true,
  judgeLabels: 3,
  teams: 8,
  forkGuaranteeEnforced: true,
  forkedComps: [],
  boardlessComps: [],
};

const unseeded: Observed = {
  compFound: false,
  boardAssignments: 0,
  boardName: null,
  boardViewLoaded: false,
  judges: 0,
  judgeViewLoaded: false,
  judgeLabels: 0,
  teams: 0,
  forkGuaranteeEnforced: true,
  forkedComps: [],
  boardlessComps: [],
};

const expected = { judges: 3, teams: 8 };

describe("summarizeHealth", () => {
  it("passes a fully seeded demo", () => {
    const health = summarizeHealth(healthy, expected);
    expect(health).toEqual({ ok: true, board: "Ananya Krishnan", judges: 3, teams: 8 });
  });

  it("fails when no live board link resolves (the dropped-column footgun)", () => {
    const health = summarizeHealth(
      { ...healthy, boardAssignments: 0, boardName: null, boardViewLoaded: false },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems).toHaveLength(1);
    expect(health.problems[0]).toMatch(/no board link/);
    expect(health.problems[0]).toMatch(/reseed/);
  });

  it("fails when the board view will not render", () => {
    const health = summarizeHealth({ ...healthy, boardViewLoaded: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/board view failed to load/);
  });

  it("fails when a judge link is missing", () => {
    const health = summarizeHealth({ ...healthy, judges: 2 }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/2 of 3 judges/);
  });

  it("fails when the judge view will not render (a judge_notes drift)", () => {
    const health = summarizeHealth({ ...healthy, judgeViewLoaded: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/judge view failed to load/);
    expect(health.problems[0]).toMatch(/reseed/);
  });

  it("fails when a judge has no de-identified label (the board export would name them)", () => {
    const health = summarizeHealth({ ...healthy, judgeLabels: 0 }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/0 of 3 judges have a Judge N label/);
  });

  it("reports the comp as unseeded before any other problem", () => {
    const health = summarizeHealth(unseeded, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems).toEqual(["comp not seeded — run 'bun run db:seed'"]);
  });

  it("fails when the chain indexes are missing — the demo can still fork its results", () => {
    const health = summarizeHealth({ ...healthy, forkGuaranteeEnforced: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/can still fork/);
    expect(health.problems[0]).toMatch(/0006/);
    expect(health.problems[0]).toMatch(/db:migrate/);
    // Reseeding does not create an index. Offering it is the demo lying about its own repair.
    expect(health.problems[0]).not.toMatch(/db:seed/);
  });

  it("fails when a comp has already forked, and does not offer to reseed it", () => {
    const health = summarizeHealth(
      { ...healthy, forkGuaranteeEnforced: false, forkedComps: [{ compId: "abc-123", roots: 2 }] },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const fork = health.problems.find((p) => p.includes("abc-123"));
    expect(fork).toMatch(/2 locked-result chains, not one/);
    expect(fork).toMatch(/human must decide/);
    expect(fork).not.toMatch(/db:seed/);
  });

  // The whole point of the check. A database missing the indexes is missing them whether or not
  // anyone has seeded a demo onto it -- and `db:seed`, the only thing the unseeded branch suggests,
  // will not add them. Swallowing this behind the short-circuit is how it stays invisible.
  it("reports a missing chain index even when the comp is not seeded", () => {
    const health = summarizeHealth({ ...unseeded, forkGuaranteeEnforced: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems).toHaveLength(2);
    expect(health.problems[0]).toMatch(/can still fork/);
    expect(health.problems[1]).toMatch(/comp not seeded/);
  });

  // A comp that has never been locked has no runs at all, so it groups to nothing and is not a fork.
  // If this ever fails, every pre-lock demo on earth is being called broken.
  it("passes a healthy database whose comp has never been locked", () => {
    const health = summarizeHealth({ ...healthy, forkedComps: [] }, expected);
    expect(health.ok).toBe(true);
  });

  it("fails when every board link of a comp is revoked, and does not offer to reseed it", () => {
    const health = summarizeHealth(
      { ...healthy, boardlessComps: [{ compId: "abc-123", revoked: 2 }] },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const boardless = health.problems.find((p) => p.includes("abc-123"));
    expect(boardless).toMatch(/not one of them still opens/);
    expect(boardless).toMatch(/minted against the existing comp/);
    // Reseeding deletes the org and cascades to the comp's scores. Answering "your board is locked
    // out" with "destroy the results" is the demo lying about its own repair.
    expect(boardless).not.toMatch(/db:seed/);
  });

  // Same reasoning as the chain indexes: a comp whose board is locked out is locked out whether or
  // not the demo happens to be seeded on this database, and `db:seed` is not the way back.
  it("reports a boardless comp even when the demo comp is not seeded", () => {
    const health = summarizeHealth(
      { ...unseeded, boardlessComps: [{ compId: "abc-123", revoked: 2 }] },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems).toHaveLength(2);
    expect(health.problems[0]).toMatch(/abc-123/);
    expect(health.problems[1]).toMatch(/comp not seeded/);
  });
});
