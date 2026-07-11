import { describe, expect, expectTypeOf, it } from "vitest";
import { judgeLabel } from "../labels";
import type { JudgeLabelView } from "../labels";
import type { BoardJudgeView, BoardTeamView, JudgeTeamView } from "../scope";

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

  it("gives the board no way to name a judge beside a score", () => {
    expectTypeOf<JudgeLabelView>().not.toHaveProperty("name");
    expectTypeOf<JudgeLabelView>().toHaveProperty("label");
  });

  it("still lets the board name a judge to send them a link and chase them", () => {
    expectTypeOf<BoardJudgeView>().toHaveProperty("name");
  });
});

describe("judgeLabel", () => {
  it("names a judge by their seat on the panel", () => {
    expect(judgeLabel(1)).toBe("Judge 1");
    expect(judgeLabel(10)).toBe("Judge 10");
  });
});
