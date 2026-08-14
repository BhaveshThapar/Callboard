import { describe, expect, expectTypeOf, it } from "vitest";
import type { RosterTeamView } from "@/lib/auth/scope";
import { noteKey } from "@/lib/export/feedback";
import { feedbackDedupeKey, planFeedbackDelivery } from "../feedback";
import type { FeedbackSnapshot } from "../feedback";
import type { MessagePayloads } from "../render";

const team = (id: string, name: string, contactPersonId: string | null): RosterTeamView => ({
  id,
  bidCode: id,
  name,
  school: null,
  performanceOrder: null,
  status: "competing",
  waitlistRank: null,
  rosterSize: 20,
  rooms: 5,
  auditionUrl: null,
  musicUrl: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  materialsSubmittedAt: null,
  rosterSizeRequested: null,
  waiverAcceptedAt: null,
  contactName: null,
  contactEmail: null,
  contactPersonId,
  customAnswers: null,
  charges: [],
  balance: { owedCents: 0, paidCents: 0, balanceCents: 0 },
});

const CONTEXT = { compName: "Mayuri 2027", boardName: "Ananya Krishnan" };

const snapshot = (over: Partial<FeedbackSnapshot> = {}): FeedbackSnapshot => ({
  runId: "run-1",
  placements: [
    { teamId: "M-2", place: 1, deductionPoints: 0 },
    { teamId: "M-3", place: 2, deductionPoints: 5 },
  ],
  deductionReasons: new Map([["M-3", ["Over time by 12 seconds"]]]),
  judges: new Map([
    ["j1", "Judge 1"],
    ["j2", "Judge 2"],
  ]),
  scoredBy: new Set([
    noteKey("j1", "M-2"),
    noteKey("j2", "M-2"),
    noteKey("j1", "M-3"),
    noteKey("j2", "M-3"),
  ]),
  notes: new Map([
    [noteKey("j1", "M-2"), "Clean formations."],
    [noteKey("j2", "M-3"), "Watch the transitions."],
  ]),
  ...over,
});

const ROSTER = [team("M-2", "NCSU Nazaare", "p2"), team("M-3", "BU Dheem", "p3")];

describe("planFeedbackDelivery", () => {
  it("tells each team its placement, its deduction and what the judges wrote", () => {
    const plan = planFeedbackDelivery(snapshot(), ROSTER, new Map(), CONTEXT);

    expect(plan.send.map((row) => row.teamId)).toEqual(["M-2", "M-3"]);
    expect(plan.send[1]?.payload).toEqual({
      teamName: "BU Dheem",
      compName: "Mayuri 2027",
      place: 2,
      deductionPoints: 5,
      deductionReasons: ["Over time by 12 seconds"],
      // A judge who scored and wrote nothing still appears, so a team can see it was judged by all
      // of them rather than wondering which one skipped it.
      notes: [
        { judge: "Judge 1", note: "" },
        { judge: "Judge 2", note: "Watch the transitions." },
      ],
      boardName: "Ananya Krishnan",
    });
  });

  it("names judges by seat, in panel order, never by name", () => {
    const plan = planFeedbackDelivery(snapshot(), ROSTER, new Map(), CONTEXT);
    expect(plan.send[0]?.payload.notes.map((n) => n.judge)).toEqual(["Judge 1", "Judge 2"]);
  });

  it("sends in placement order rather than roster order", () => {
    const plan = planFeedbackDelivery(
      snapshot({
        placements: [
          { teamId: "M-3", place: 2, deductionPoints: 0 },
          { teamId: "M-2", place: 1, deductionPoints: 0 },
        ],
      }),
      ROSTER,
      new Map(),
      CONTEXT,
    );
    expect(plan.send.map((row) => row.payload.place)).toEqual([1, 2]);
  });

  /**
   * `teams` is the roster of record and the snapshot is what was announced. A team that withdrew
   * before the lock has no placement, so there is nothing to tell it about.
   */
  it("says nothing to a team that is not in the locked results", () => {
    const plan = planFeedbackDelivery(
      snapshot({ placements: [{ teamId: "M-2", place: 1, deductionPoints: 0 }] }),
      ROSTER,
      new Map(),
      CONTEXT,
    );
    expect(plan.send.map((row) => row.teamId)).toEqual(["M-2"]);
  });

  it("names a placed team it cannot reach", () => {
    const plan = planFeedbackDelivery(
      snapshot(),
      [ROSTER[0]!, team("M-3", "BU Dheem", null)],
      new Map(),
      CONTEXT,
    );
    expect(plan.skipped).toEqual([{ teamId: "M-3", teamName: "BU Dheem", reason: "no-contact" }]);
  });

  it("omits a judge who neither scored nor wrote", () => {
    const plan = planFeedbackDelivery(
      snapshot({ scoredBy: new Set([noteKey("j1", "M-2")]), notes: new Map() }),
      ROSTER,
      new Map(),
      CONTEXT,
    );
    expect(plan.send[0]?.payload.notes).toEqual([{ judge: "Judge 1", note: "" }]);
  });
});

describe("feedbackDedupeKey", () => {
  /**
   * The property worth having: an override supersedes the run, so corrected feedback is deliverable
   * while a second click against the same run reaches nobody twice. A key on the team alone would
   * make a correction undeliverable — the one time a board most needs to send again.
   */
  it("changes with the run, so a correction can be delivered", () => {
    expect(feedbackDedupeKey("M-2", "run-1")).toBe(feedbackDedupeKey("M-2", "run-1"));
    expect(feedbackDedupeKey("M-2", "run-2")).not.toBe(feedbackDedupeKey("M-2", "run-1"));
  });
});

/**
 * The one that must never be weakened. A team learns where it placed and what was said, never what
 * was given — publishing numbers invites a team to litigate a 27-vs-28 on Execution, an argument no
 * board can win and no rubric can settle (ADR-0008). The planner is handed `scoredBy` as keys with
 * no values, so it cannot leak a score even by mistake: it never holds one.
 */
describe("what a team is never told", () => {
  it("has no score anywhere in the payload type", () => {
    type Payload = MessagePayloads["feedback.delivered"];
    expectTypeOf<Payload>().not.toHaveProperty("scores");
    expectTypeOf<Payload>().not.toHaveProperty("score");
    expectTypeOf<Payload>().not.toHaveProperty("aggregate");
    expectTypeOf<Payload>().not.toHaveProperty("criteria");
    expectTypeOf<Payload>().not.toHaveProperty("judgeScores");
  });

  it("carries no judge's name and no other team", () => {
    const plan = planFeedbackDelivery(snapshot(), ROSTER, new Map(), CONTEXT);
    const rendered = JSON.stringify(plan.send[0]?.payload);

    expect(rendered).not.toContain("BU Dheem");
    expect(rendered).not.toContain("M-3");
    expect(rendered).toContain("Judge 1");
  });
});
