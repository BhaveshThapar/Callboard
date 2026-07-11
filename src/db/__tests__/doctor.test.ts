import { describe, expect, it } from "vitest";
import type { Observed } from "../health";
import { summarizeHealth } from "../health";

const healthy: Observed = {
  compFound: true,
  boardAssignments: 1,
  boardName: "Ananya Krishnan",
  boardViewLoaded: true,
  judges: 3,
  judgeViewLoaded: true,
  teams: 8,
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

  it("reports the comp as unseeded before any other problem", () => {
    const health = summarizeHealth(
      {
        compFound: false,
        boardAssignments: 0,
        boardName: null,
        boardViewLoaded: false,
        judges: 0,
        judgeViewLoaded: false,
        teams: 0,
      },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems).toEqual(["comp not seeded — run 'bun run db:seed'"]);
  });
});
