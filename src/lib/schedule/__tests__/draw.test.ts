import { describe, expect, it } from "vitest";
import { move, redraw, showOrderFrom } from "../draw";
import type { DrawCandidate } from "../draw";

const c = (teamId: string, position: number | null, bidCode = teamId.toUpperCase()): DrawCandidate => ({
  teamId,
  position,
  bidCode,
});

const applied = (candidates: DrawCandidate[], rewrites: { teamId: string; position: number }[]) =>
  candidates
    .map((cand) => {
      const hit = rewrites.find((r) => r.teamId === cand.teamId);
      return hit ? { ...cand, position: hit.position } : cand;
    })
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
    .map((cand) => cand.teamId);

describe("redraw", () => {
  it("numbers the stated order 1..N", () => {
    const teams = [c("a", null), c("b", null), c("c", null)];
    expect(redraw(teams, ["c", "a", "b"])).toEqual([
      { teamId: "c", position: 1 },
      { teamId: "a", position: 2 },
      { teamId: "b", position: 3 },
    ]);
  });

  it("returns only the rows that actually change", () => {
    const teams = [c("a", 1), c("b", 2), c("c", 3)];
    expect(redraw(teams, ["a", "b", "c"])).toEqual([]);
    expect(redraw(teams, ["a", "c", "b"])).toEqual([
      { teamId: "c", position: 2 },
      { teamId: "b", position: 3 },
    ]);
  });

  it("appends a team the board did not name rather than dropping it from the show", () => {
    const teams = [c("a", 1), c("b", 2), c("c", 3)];
    const rewrites = redraw(teams, ["c", "a"]);
    expect(applied(teams, rewrites)).toEqual(["c", "a", "b"]);
  });

  it("closes the hole a drop left behind", () => {
    // 'b' has been dropped and is no longer a candidate; the show should run 1,2 rather than 1,3.
    const teams = [c("a", 1), c("c", 3)];
    expect(redraw(teams, ["a", "c"])).toEqual([{ teamId: "c", position: 2 }]);
  });

  it("ignores an id that is not in the draw, and does not count it toward a position", () => {
    const teams = [c("a", null), c("b", null)];
    expect(redraw(teams, ["ghost", "b", "a"])).toEqual([
      { teamId: "b", position: 1 },
      { teamId: "a", position: 2 },
    ]);
  });

  it("ignores a repeated id rather than giving one team two slots", () => {
    const teams = [c("a", null), c("b", null)];
    expect(redraw(teams, ["a", "a", "b"])).toEqual([
      { teamId: "a", position: 1 },
      { teamId: "b", position: 2 },
    ]);
  });

  it("is deterministic when nothing has been drawn and nothing is stated", () => {
    const teams = [c("c", null, "ZZZ"), c("a", null, "AAA"), c("b", null, "MMM")];
    expect(redraw(teams, [])).toEqual(redraw(teams, []));
    expect(applied(teams, redraw(teams, []))).toEqual(["a", "b", "c"]);
  });
});

describe("move", () => {
  const three = [c("a", 1), c("b", 2), c("c", 3)];

  it("trades two adjacent positions and touches nobody else", () => {
    expect(move(three, "c", "up")).toEqual([
      { teamId: "c", position: 2 },
      { teamId: "b", position: 3 },
    ]);
    expect(applied(three, move(three, "c", "up"))).toEqual(["a", "c", "b"]);
  });

  it("refuses a move off either end", () => {
    expect(move(three, "a", "up")).toEqual([]);
    expect(move(three, "c", "down")).toEqual([]);
  });

  it("refuses to move a team that was never drawn", () => {
    expect(move([...three, c("d", null)], "d", "up")).toEqual([]);
  });

  it("trades across a gap rather than renumbering to close it", () => {
    // Positions 1 and 7 with nothing between: the emcee's sheet keeps every other number.
    const gapped = [c("a", 1), c("b", 7)];
    expect(move(gapped, "b", "up")).toEqual([
      { teamId: "b", position: 1 },
      { teamId: "a", position: 7 },
    ]);
  });
});

describe("showOrderFrom", () => {
  it("hands the engine the drawn teams in order, and leaves out the undrawn", () => {
    expect(showOrderFrom([c("b", 2), c("a", 1), c("d", null), c("c", 3)])).toEqual([
      { teamId: "a", position: 1 },
      { teamId: "b", position: 2 },
      { teamId: "c", position: 3 },
    ]);
  });
});
