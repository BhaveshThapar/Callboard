import { describe, expect, expectTypeOf, it } from "vitest";
import { ACCOUNT_ROLES, INVITABLE_ROLES } from "@/db/schema/accounts";
import { judgeLabel } from "../labels";
import type { JudgeLabelView } from "../labels";
import type { PublicComp, PublicPlacement, PublicTeam } from "@/lib/comp/public";
import type {
  BoardJudgeView,
  BoardTeamView,
  JudgeTeamView,
  LiaisonActor,
  RosterTeamView,
  TeamActor,
  TeamOwnView,
} from "../scope";

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

  /**
   * The fourth window, and the one whose scope lives on the actor rather than in a `where`. A
   * captain's `teamId` comes off a membership row, so this projection is a single team by
   * construction — but it must also carry no *other* team, which is what these assert. A `roster`
   * field here would be the whole comp handed to one competitor.
   */
  it("gives a captain their own team and no way to reach another", () => {
    expectTypeOf<TeamOwnView>().toHaveProperty("balance");
    expectTypeOf<TeamOwnView>().toHaveProperty("charges");
    expectTypeOf<TeamOwnView>().toHaveProperty("name");
    expectTypeOf<TeamOwnView>().not.toHaveProperty("roster");
    expectTypeOf<TeamOwnView>().not.toHaveProperty("teams");
  });

  /**
   * A captain is a competitor, and a competitor holding the mapping from names to bid codes is the
   * end of blind judging for that comp — the same argument `publicComp` is built on, arriving from
   * inside the product rather than from the street. Their *own* code is fine: they already know
   * which team they are.
   */
  it("gives a captain no score, and no bid code but their own", () => {
    expectTypeOf<TeamOwnView>().toHaveProperty("bidCode");
    expectTypeOf<TeamOwnView>().not.toHaveProperty("scores");
    expectTypeOf<TeamOwnView>().not.toHaveProperty("placements");
    expectTypeOf<TeamOwnView>().not.toHaveProperty("standings");
  });

  /** A session-derived actor carries the team it may act for, so a form cannot supply one. */
  it("puts the captain's team on the actor rather than on a form", () => {
    expectTypeOf<TeamActor>().toHaveProperty("teamId");
    expectTypeOf<TeamActor>().toHaveProperty("compId");
    expectTypeOf<LiaisonActor>().not.toHaveProperty("teamId");
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

/**
 * A credential a board can mint must open something. `ACCOUNT_ROLES` says what a membership may be;
 * `INVITABLE_ROLES` says what may be handed out, and the gap between them is deliberate.
 */
describe("INVITABLE_ROLES", () => {
  it("offers no role with nothing behind it", () => {
    // `liaison` has an actor kind, a resolver and no reader — nothing in the product answers *what
    // does a liaison see*, because that is C1's question and C1 needs a table that does not exist.
    // Offering it let a board mint a link whose whole journey ended on a page that refused to load,
    // which is what ADR-0011 spent a decision refusing. Put it back in the same commit as the
    // screen; this test is what asks whether you did.
    expect(INVITABLE_ROLES).not.toContain("liaison");
  });

  it("offers only roles a membership can actually hold", () => {
    for (const role of INVITABLE_ROLES) expect(ACCOUNT_ROLES).toContain(role);
  });
});
