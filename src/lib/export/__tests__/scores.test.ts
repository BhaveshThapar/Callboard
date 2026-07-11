import { describe, expect, it } from "vitest";
import type { ScoreAuditInput } from "../scores";
import { toScoreAuditCsv } from "../scores";

const CRITERIA = [
  { id: "c1", label: "Choreography" },
  { id: "c2", label: "Execution" },
];

const base = (): ScoreAuditInput => ({
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
    ["j1", "Judge 1"],
    ["j2", "Judge 2"],
  ]),
});

const lines = (csv: string): string[] => csv.split("\r\n");

describe("toScoreAuditCsv", () => {
  it("names one column per criterion, in rubric order", () => {
    expect(lines(toScoreAuditCsv(base()))[0]).toBe(
      "Place,Team,Bid code,Judge,Choreography,Execution,Judge total,Team deduction",
    );
  });

  it("gives the board the breakdown without naming a single judge", () => {
    const csv = toScoreAuditCsv(base());
    expect(csv).toContain("Judge 1");
    expect(csv).toContain("Judge 2");
    expect(csv).not.toContain("Priya");
    expect(csv).not.toContain("Arjun");
  });

  it("writes one row per team per judge, ordered by place then panel order", () => {
    const rows = lines(toScoreAuditCsv(base())).slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("1,NCSU Nazaare,A-114,Judge 1");
    expect(rows[1]).toContain("1,NCSU Nazaare,A-114,Judge 2");
    expect(rows[2]).toContain("2,BU Dheem,B-207,Judge 1");
  });

  it("orders the panel by label_seq, not by the text of the label", () => {
    const input = base();
    input.judges = new Map([
      ["j1", "Judge 1"],
      ["j2", "Judge 2"],
      ["j10", "Judge 10"],
    ]);
    input.scores = [
      ...input.scores,
      { judgeId: "j10", teamId: "t1", criterionId: "c1", rawValue: 25 },
    ];

    const labels = lines(toScoreAuditCsv(input))
      .slice(1)
      .filter((r) => r.includes("NCSU Nazaare"))
      .map((r) => r.split(",")[3]);

    expect(labels).toEqual(["Judge 1", "Judge 2", "Judge 10"]);
  });

  it("totals a judge's raw values for that team", () => {
    const rows = lines(toScoreAuditCsv(base())).slice(1);
    expect(rows[0]).toContain("30,28,58");
    expect(rows[2]).toContain("20,18,38");
  });

  it("carries the team's deduction onto every one of its rows", () => {
    const rows = lines(toScoreAuditCsv(base())).slice(1);
    expect(rows[2]).toMatch(/,-2$/);
    expect(rows[0]).toMatch(/,0$/);
  });

  it("omits a judge who did not score a team", () => {
    const rows = lines(toScoreAuditCsv(base())).slice(1);
    expect(rows.filter((r) => r.includes("BU Dheem"))).toHaveLength(1);
  });

  it("leaves a missed criterion blank rather than scoring it zero", () => {
    const input = base();
    input.scores = [{ judgeId: "j1", teamId: "t1", criterionId: "c1", rawValue: 30 }];
    input.judges = new Map([["j1", "Judge 1"]]);

    const rows = lines(toScoreAuditCsv(input)).slice(1);
    expect(rows[0]).toBe("1,NCSU Nazaare,A-114,Judge 1,30,,30,0");
  });
});
