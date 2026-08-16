import { describe, expect, it } from "vitest";
import type { DutyConfig } from "@/db/schema";
import { labelFor, planAssignment, resolveDuty } from "../duties";

const DUTIES: DutyConfig[] = [
  { id: "walk", label: "Team liaison", category: "team", swaRequired: true },
  { id: "runner", label: "Judge runner", category: "judge", swaRequired: false },
  { id: "door", label: "Door greeter", category: "general", swaRequired: false },
];

const TEAM = "11111111-1111-1111-1111-111111111111";

describe("resolveDuty / labelFor", () => {
  it("finds a duty the comp declared", () => {
    expect(resolveDuty(DUTIES, "walk")?.label).toBe("Team liaison");
  });

  /**
   * The realistic failure: a board rewords its duty list in February and an assignment filed in
   * January still points at the old key. Showing the raw `duty_id` reads as a bug in the product
   * rather than a gap in the config, so the absence is stated -- `BillingGap`'s discipline.
   */
  it("renders a duty the comp no longer lists as a stated absence, never as its raw key", () => {
    const label = labelFor(DUTIES, "food_runner");
    expect(label).not.toContain("food_runner");
    expect(label).toMatch(/no longer lists/);
  });

  it("says the same thing for a comp that declared no duties at all", () => {
    expect(labelFor(null, "walk")).toMatch(/no longer lists/);
    expect(resolveDuty(null, "walk")).toBeNull();
  });
});

describe("planAssignment", () => {
  it("refuses a duty this comp never declared", () => {
    const result = planAssignment(DUTIES, "invented", null);
    expect(result).toEqual({ ok: false, message: "This comp does not list that duty." });
  });

  /**
   * `assignments_team_check` is the guarantee and stays it. This is the sentence a person reads
   * instead of the constraint name -- the ledger's division of labour, in the other domain.
   */
  it("refuses a team duty with no team, naming the duty rather than the constraint", () => {
    const result = planAssignment(DUTIES, "walk", null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Team liaison");
      expect(result.message).not.toContain("assignments_team_check");
    }
  });

  it("refuses a duty that is not about a team from carrying one", () => {
    const result = planAssignment(DUTIES, "door", TEAM);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Door greeter");
  });

  it("carries the category and swaRequired off the config, never off the caller", () => {
    const result = planAssignment(DUTIES, "walk", TEAM);
    expect(result).toEqual({
      ok: true,
      value: { dutyId: "walk", category: "team", swaRequired: true, teamId: TEAM },
    });
  });

  it("accepts a non-team duty with no team", () => {
    const result = planAssignment(DUTIES, "runner", null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.category).toBe("judge");
  });
});
