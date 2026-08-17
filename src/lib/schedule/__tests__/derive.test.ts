import { describe, expect, it } from "vitest";
import { derive } from "../derive";
import { BUFFERS, EIGHT_TEAMS } from "./fixtures";
import type { BufferConfig } from "../types";

const at = (r: ReturnType<typeof derive>, kind: string, teamId: string | null) =>
  r.segments.find((s) => s.kind === kind && s.teamId === teamId);

describe("derive — the running order", () => {
  it("puts each team's slot a full step after the one before, in position order", () => {
    const r = derive(EIGHT_TEAMS, BUFFERS);
    // step = slot 8 + changeover 4 = 12; walk ends exactly at the slot start.
    expect(at(r, "walk", "team-a")?.endsAtMinute).toBe(120);
    expect(at(r, "walk", "team-b")?.endsAtMinute).toBe(132);
    expect(at(r, "walk", "team-h")?.endsAtMinute).toBe(204);
  });

  it("sorts the draw rather than trusting the order the rows arrived in", () => {
    const shuffled = { ...EIGHT_TEAMS, showOrder: [...EIGHT_TEAMS.showOrder].reverse() };
    expect(derive(shuffled, BUFFERS)).toEqual(derive(EIGHT_TEAMS, BUFFERS));
  });

  it("hangs every buffer off its own team's slot, so nothing chains cell-above-cell", () => {
    const r = derive(EIGHT_TEAMS, BUFFERS);
    // team-a: stretch ends 30 before, lasts 20; lobby ends 12 before, lasts 10.
    expect(at(r, "stretch", "team-a")).toMatchObject({ startsAtMinute: 70, endsAtMinute: 90 });
    expect(at(r, "lobby", "team-a")).toMatchObject({ startsAtMinute: 98, endsAtMinute: 108 });
  });

  it("puts a negatively-anchored segment after the performance", () => {
    const r = derive(EIGHT_TEAMS, BUFFERS);
    expect(at(r, "tech_out", "team-a")).toMatchObject({ startsAtMinute: 123, endsAtMinute: 128 });
  });
});

describe("derive — zero is not null", () => {
  it("produces no segment at all for a buffer the comp does not run", () => {
    const r = derive(EIGHT_TEAMS, BUFFERS);
    expect(r.segments.filter((s) => s.kind === "props")).toEqual([]);
    expect(r.gaps.filter((g) => g.kind === "props")).toEqual([]);
  });

  it("states a gap for an unstated duration, and never a zero-minute segment", () => {
    const buffers: BufferConfig = {
      ...BUFFERS,
      teamBuffers: [{ kind: "tech_in", durationMinutes: null, endsBeforePerformance: 15, room: null }],
    };
    const r = derive(EIGHT_TEAMS, buffers);
    // Only the team half is unstated, so only the team half goes missing. The comp-wide fixtures are
    // still derived, which is the point: one unanswered question does not blank the whole schedule.
    expect(r.segments.filter((s) => s.teamId !== null)).toEqual([]);
    expect(r.gaps).toEqual([{ kind: "tech_in", teamId: null, missing: "durationMinutes" }]);
  });

  it("reports an unstated buffer once, not once per team", () => {
    const buffers: BufferConfig = {
      ...BUFFERS,
      teamBuffers: [{ kind: "tech_in", durationMinutes: null, endsBeforePerformance: 15, room: null }],
    };
    // Eight teams in the draw, one gap: a board fixes this with one number.
    expect(derive(EIGHT_TEAMS, buffers).gaps).toHaveLength(1);
  });

  it("derives nothing and says why when no slot length was stated", () => {
    const r = derive(EIGHT_TEAMS, { ...BUFFERS, slotMinutes: null });
    expect(r.segments).toEqual([]);
    expect(r.gaps).toEqual([{ kind: "walk", teamId: null, missing: "slotMinutes" }]);
  });
});

describe("derive — a delay re-derives the cascade (G3)", () => {
  const delayed = {
    ...EIGHT_TEAMS,
    delays: [{ seq: 1, minutes: 12, fromPosition: 4, reason: "late start" }],
  };

  it("does not re-time a team that has already danced", () => {
    const before = derive(EIGHT_TEAMS, BUFFERS);
    const after = derive(delayed, BUFFERS);
    expect(at(after, "walk", "team-c")).toEqual(at(before, "walk", "team-c"));
  });

  it("moves every team from the delay's position onward, and their buffers with them", () => {
    const after = derive(delayed, BUFFERS);
    expect(at(after, "walk", "team-d")?.endsAtMinute).toBe(156 + 12);
    expect(at(after, "stretch", "team-d")?.startsAtMinute).toBe(156 + 12 - 30 - 20);
  });

  it("compounds two delays rather than taking the later one", () => {
    const twice = {
      ...EIGHT_TEAMS,
      delays: [
        { seq: 1, minutes: 12, fromPosition: 4, reason: "late start" },
        { seq: 2, minutes: 9, fromPosition: 6, reason: "tech fault" },
      ],
    };
    const r = derive(twice, BUFFERS);
    expect(r.totalDelayMinutes).toBe(21);
    expect(at(r, "walk", "team-f")?.endsAtMinute).toBe(180 + 21);
  });

  it("moves a fixture defined against the show and leaves one defined against a clock", () => {
    const r = derive(delayed, BUFFERS);
    expect(at(r, "food", null)?.startsAtMinute).toBe(300);
    expect(at(r, "judge_cutoff", null)?.startsAtMinute).toBe(412);
  });
});

describe("derive — buffer awareness (G6)", () => {
  const withDelay = (minutes: number) =>
    derive({ ...EIGHT_TEAMS, delays: [{ seq: 1, minutes, fromPosition: 1, reason: "x" }] }, BUFFERS);

  it("spends the pools in the order the board declared them", () => {
    const r = withDelay(12);
    expect(r.slack).toMatchObject([
      { id: "filler", consumedMinutes: 8, remainingMinutes: 0 },
      { id: "judge_held", consumedMinutes: 4, remainingMinutes: 6 },
    ]);
  });

  it("names only the pools actually used up", () => {
    expect(withDelay(12).exhausted).toEqual(["filler"]);
    expect(withDelay(5).exhausted).toEqual([]);
  });

  it("reports the minutes no slack can absorb, which is the number that means something must give", () => {
    expect(withDelay(12).unabsorbedMinutes).toBe(0);
    expect(withDelay(25).unabsorbedMinutes).toBe(7);
    expect(withDelay(25).exhausted).toEqual(["filler", "judge_held"]);
  });

  it("does not call a declared-but-empty pool exhausted before the doors open", () => {
    const buffers = { ...BUFFERS, slack: [{ id: "none", label: "None", minutes: 0 }] };
    expect(derive(EIGHT_TEAMS, buffers).exhausted).toEqual([]);
  });
});
