import { describe, expect, it } from "vitest";
import type { TeamFeedbackInput } from "../feedback";
import { noteKey, toTeamFeedbackCsv } from "../feedback";

const base = (): TeamFeedbackInput => ({
  placements: [
    { teamId: "t1", place: 1, deductionPoints: 0 },
    { teamId: "t2", place: 2, deductionPoints: 2 },
  ],
  deductionReasons: new Map([["t2", ["Exceeded the 8:00 limit by 14s"]]]),
  teams: new Map([
    ["t1", { name: "NCSU Nazaare", bidCode: "A-114" }],
    ["t2", { name: "BU Dheem", bidCode: "B-207" }],
  ]),
  judges: new Map([
    ["j1", "Judge 1"],
    ["j2", "Judge 2"],
  ]),
  scoredBy: new Set([noteKey("j1", "t1"), noteKey("j2", "t1"), noteKey("j1", "t2")]),
  notes: new Map([[noteKey("j1", "t1"), "Tight formations. Watch the third transition."]]),
});

const lines = (csv: string): string[] => csv.split("\r\n");

describe("toTeamFeedbackCsv", () => {
  it("carries no score, and no column that could hold one", () => {
    const csv = toTeamFeedbackCsv(base());
    expect(lines(csv)[0]).toBe("Place,Team,Bid code,Team deduction,Deduction reason,Judge,Note");
    expect(csv).not.toContain("Judge total");
    expect(csv).not.toContain("Choreography");
  });

  it("names judges by label, never by name", () => {
    const csv = toTeamFeedbackCsv(base());
    expect(csv).toContain("Judge 1");
    expect(csv).toContain("Judge 2");
    expect(csv).not.toContain("Priya");
    expect(csv).not.toContain("Arjun");
  });

  it("writes one row per team per judge, ordered by place then panel order", () => {
    const rows = lines(toTeamFeedbackCsv(base())).slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("1,NCSU Nazaare,A-114");
    expect(rows[0]).toContain("Judge 1");
    expect(rows[1]).toContain("Judge 2");
    expect(rows[2]).toContain("2,BU Dheem,B-207");
  });

  it("orders the panel by label_seq, not by the text of the label", () => {
    // Sorted as text, "Judge 10" files ahead of "Judge 2". The Map's insertion order is the panel
    // order, so a tenth judge must still come last.
    const input = base();
    input.judges = new Map([
      ["j1", "Judge 1"],
      ["j2", "Judge 2"],
      ["j10", "Judge 10"],
    ]);
    input.scoredBy = new Set([noteKey("j1", "t1"), noteKey("j2", "t1"), noteKey("j10", "t1")]);

    const rows = lines(toTeamFeedbackCsv(input)).slice(1);
    expect(rows.map((r) => r.split(",")[5])).toEqual(["Judge 1", "Judge 2", "Judge 10"]);
  });

  it("attaches the note to the judge who wrote it, and only to them", () => {
    const rows = lines(toTeamFeedbackCsv(base())).slice(1);
    expect(rows[0]).toContain("Tight formations. Watch the third transition.");
    expect(rows[1]).not.toContain("Tight formations");
    expect(rows[2]).not.toContain("Tight formations");
  });

  it("gives the team its deduction and the reason recorded against it", () => {
    const rows = lines(toTeamFeedbackCsv(base())).slice(1);
    expect(rows[2]).toContain("-2,Exceeded the 8:00 limit by 14s");
    expect(rows[0]).toContain(",0,,");
  });

  it("joins multiple deductions against one team", () => {
    const input = base();
    input.deductionReasons = new Map([["t2", ["Over time by 14s", "Prop left on stage"]]]);
    expect(toTeamFeedbackCsv(input)).toContain("Over time by 14s; Prop left on stage");
  });

  it("omits a judge who neither scored nor wrote to a team", () => {
    const rows = lines(toTeamFeedbackCsv(base())).slice(1);
    expect(rows.filter((r) => r.includes("BU Dheem"))).toHaveLength(1);
  });

  it("still ships a note from a judge who scored nothing for that team", () => {
    // Scores and notes are independent forms, so a judge can write feedback without scoring.
    const input = base();
    input.notes = new Map([[noteKey("j2", "t2"), "Did not finish scoring, but: lovely musicality."]]);

    const row = lines(toTeamFeedbackCsv(input))
      .slice(1)
      .find((r) => r.includes("BU Dheem") && r.includes("Judge 2"));

    expect(row).toContain("lovely musicality");
  });

  it("quotes a note containing a comma", () => {
    const input = base();
    input.notes = new Map([[noteKey("j1", "t1"), "Strong, but rushed"]]);
    expect(toTeamFeedbackCsv(input)).toContain('"Strong, but rushed"');
  });

  it("falls back to the id when a team is missing from the roster", () => {
    const input = base();
    input.teams = new Map();
    expect(lines(toTeamFeedbackCsv(input))[1]).toContain("1,t1,");
  });
});
