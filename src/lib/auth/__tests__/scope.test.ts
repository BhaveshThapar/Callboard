import { describe, expect, expectTypeOf, it } from "vitest";
import { judgeLabel } from "../labels";
import type { JudgeLabelView } from "../labels";
import type { PublicComp, PublicPlacement, PublicTeam } from "@/lib/comp/public";
import type { BoardJudgeView, BoardTeamView, JudgeTeamView, RosterTeamView } from "../scope";

/**
 * Both directions of blindness are enforced by the shape of a type rather than by a filter someone
 * has to remember to write, so most of what is worth asserting is asserted at compile time. These
 * fail under `tsc --noEmit`, which is the point: putting the field back is what has to break.
 *
 * `scope.ts` itself reaches for the database, so only its types are imported here.
 */
describe("the projections", () => {
  it("gives a judge no way to name a team", () => {
    expectTypeOf<JudgeTeamView>().not.toHaveProperty("name");
    expectTypeOf<JudgeTeamView>().not.toHaveProperty("school");
    expectTypeOf<JudgeTeamView>().toHaveProperty("bidCode");
  });

  it("gives the board the team names the judge cannot have", () => {
    expectTypeOf<BoardTeamView>().toHaveProperty("name");
  });

  // A judge who can see which teams are behind on payment knows something about a team, and knowing
  // anything about a team beside its bid code is what ADR-0008 exists to prevent. A3 widens the
  // *roster* window only; the scoring windows are a different question and must stay one.
  it("gives a judge no way to learn which teams have paid", () => {
    expectTypeOf<JudgeTeamView>().not.toHaveProperty("balance");
    expectTypeOf<JudgeTeamView>().not.toHaveProperty("charges");
    expectTypeOf<BoardTeamView>().not.toHaveProperty("balance");
    expectTypeOf<BoardTeamView>().not.toHaveProperty("charges");
  });

  it("joins the roster to what each team owes, which is A3", () => {
    expectTypeOf<RosterTeamView>().toHaveProperty("balance");
    expectTypeOf<RosterTeamView>().toHaveProperty("charges");
    expectTypeOf<RosterTeamView>().toHaveProperty("name");
  });

  it("gives the board no way to name a judge beside a score", () => {
    expectTypeOf<JudgeLabelView>().not.toHaveProperty("name");
    expectTypeOf<JudgeLabelView>().toHaveProperty("label");
  });

  it("still lets the board name a judge to send them a link and chase them", () => {
    expectTypeOf<BoardJudgeView>().toHaveProperty("name");
  });

  /**
   * The attendee's projection is the widest audience in the product, so it is the one where a
   * leaked field is least recoverable. A bid code here is the worst of them: the judge whose whole
   * view is bid codes can read this page, and a public name-to-code mapping is the end of blind
   * judging for that comp. Nothing else on the page is secret, which is exactly why this one is
   * asserted rather than assumed.
   */
  it("gives the public no way to pair a team with the bid code its judges see", () => {
    expectTypeOf<PublicTeam>().not.toHaveProperty("bidCode");
    expectTypeOf<PublicTeam>().not.toHaveProperty("id");
    expectTypeOf<PublicPlacement>().not.toHaveProperty("bidCode");
    expectTypeOf<PublicPlacement>().not.toHaveProperty("teamId");
  });

  it("gives the public a placement without the numbers behind it", () => {
    expectTypeOf<PublicPlacement>().toHaveProperty("place");
    expectTypeOf<PublicPlacement>().not.toHaveProperty("aggregate");
    expectTypeOf<PublicPlacement>().not.toHaveProperty("judgeCount");
    expectTypeOf<PublicComp>().not.toHaveProperty("scores");
  });
});

describe("judgeLabel", () => {
  it("names a judge by their seat on the panel", () => {
    expect(judgeLabel(1)).toBe("Judge 1");
    expect(judgeLabel(10)).toBe("Judge 10");
  });
});
