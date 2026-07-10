import { describe, expect, it } from "vitest";
import type { FeedbackInput } from "../feedback";
import { noteKey, toFeedbackCsv } from "../feedback";

const CRITERIA = [
  { id: "c1", label: "Choreography" },
  { id: "c2", label: "Execution" },
];

const base = (): FeedbackInput => ({
  placements: [
    { teamId: "t1", place: 1, deductionPoints: 0 },
    { teamId: "t2", place: 2, deductionPoints: 2 },
  ],
  criteria: CRITERIA,
  scores: [
    { judgeId: "j1", teamId: "t1", criterionId: "c1", rawValue: 30 },
    { judgeId: "j1", teamId: "t1", criterionId: "c2", rawValue: 28 },
    { judgeId: "j1", teamId: "t2", criterionId: "c1", rawValue: 20 },
    { judgeId: "j1", teamId: "t2", criterionId: "c2", rawValue: 18 },
    { judgeId: "j2", teamId: "t1", criterionId: "c1", rawValue: 29 },
    { judgeId: "j2", teamId: "t1", criterionId: "c2", rawValue: 27 },
  ],
  teams: new Map([
    ["t1", { name: "NCSU Nazaare", bidCode: "A-114" }],
    ["t2", { name: "BU Dheem", bidCode: "B-207" }],
  ]),
  judges: new Map([
    ["j2", "Arjun Mehta"],
    ["j1", "Priya Raghavan"],
  ]),
  notes: new Map([[noteKey("j1", "t1"), "Tight formations. Watch the third transition."]]),
});

const lines = (csv: string): string[] => csv.split("\r\n");

describe("toFeedbackCsv", () => {
  it("names one column per criterion, in rubric order", () => {
    expect(lines(toFeedbackCsv(base()))[0]).toBe(
      "Place,Team,Bid code,Judge,Choreography,Execution,Judge total,Team deduction,Note",
    );
  });

  it("writes one row per team per judge, ordered by place then judge name", () => {
    const rows = lines(toFeedbackCsv(base())).slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("1,NCSU Nazaare,A-114,Arjun Mehta");
    expect(rows[1]).toContain("1,NCSU Nazaare,A-114,Priya Raghavan");
    expect(rows[2]).toContain("2,BU Dheem,B-207,Priya Raghavan");
  });

  it("totals a judge's raw values for that team", () => {
    const rows = lines(toFeedbackCsv(base())).slice(1);
    expect(rows[1]).toContain("30,28,58");
    expect(rows[2]).toContain("20,18,38");
  });

  it("attaches the note to the judge who wrote it, and only to them", () => {
    const rows = lines(toFeedbackCsv(base())).slice(1);
    expect(rows[1]).toContain("Tight formations. Watch the third transition.");
    expect(rows[0]).not.toContain("Tight formations");
    expect(rows[2]).not.toContain("Tight formations");
  });

  it("carries the team's deduction onto every one of its rows", () => {
    const rows = lines(toFeedbackCsv(base())).slice(1);
    expect(rows[2]).toContain(",-2,");
    expect(rows[1]).toContain(",0,");
  });

  it("omits a judge who did not score a team, rather than emitting a blank row", () => {
    const rows = lines(toFeedbackCsv(base())).slice(1);
    expect(rows.filter((r) => r.includes("BU Dheem"))).toHaveLength(1);
  });

  it("quotes a note containing a comma", () => {
    const input = base();
    input.notes = new Map([[noteKey("j1", "t1"), "Strong, but rushed"]]);
    expect(toFeedbackCsv(input)).toContain('"Strong, but rushed"');
  });

  it("falls back to ids when a team or judge is missing from the roster", () => {
    const input = base();
    input.teams = new Map();
    input.judges = new Map([["j1", "Priya Raghavan"]]);
    const rows = lines(toFeedbackCsv(input)).slice(1);
    expect(rows[0]).toContain("1,t1,,Priya Raghavan");
  });
});
