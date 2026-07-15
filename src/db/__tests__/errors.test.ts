import { describe, expect, it } from "vitest";
import { violatedConstraint } from "../errors";

/**
 * The shape drizzle actually throws: its own error, whose `message` is the failed SQL, wrapping the
 * driver's error, which is the only thing carrying `constraint`. Every assertion here exists because
 * reading the wrong layer is the failure — `error.message` is what puts `insert into "teams" ...` in
 * front of a stranger filling in a registration form.
 */
const drizzleWrapped = (constraint: string): Error => {
  const driver = Object.assign(new Error('duplicate key value violates unique constraint'), {
    constraint,
    code: "23505",
  });
  return new Error('Failed query: insert into "teams" ("comp_id", "bid_code") values ($1, $2)', {
    cause: driver,
  });
};

describe("violatedConstraint", () => {
  it("digs the constraint out of the cause, not the message", () => {
    const error = drizzleWrapped("teams_comp_bid_code_unique");

    expect(violatedConstraint(error)).toBe("teams_comp_bid_code_unique");
    // The thing we must never branch on, asserted so it stays visible.
    expect(error.message).toContain("Failed query");
    expect(error.message).not.toContain("teams_comp_bid_code_unique");
  });

  it("finds it however deep the cause chain goes", () => {
    const inner = drizzleWrapped("tab_runs_root_unique");
    const outer = new Error("something else went wrong", { cause: inner });

    expect(violatedConstraint(outer)).toBe("tab_runs_root_unique");
  });

  it("reads it off the error itself when nothing wrapped it", () => {
    const bare = Object.assign(new Error("nope"), { constraint: "teams_status_check" });

    expect(violatedConstraint(bare)).toBe("teams_status_check");
  });

  it("returns null for an error that violated no constraint", () => {
    expect(violatedConstraint(new Error("connection reset"))).toBeNull();
    expect(violatedConstraint(new Error("outer", { cause: new Error("inner") }))).toBeNull();
  });

  it("returns null rather than throwing on whatever else lands in a catch", () => {
    expect(violatedConstraint(undefined)).toBeNull();
    expect(violatedConstraint("a string")).toBeNull();
    expect(violatedConstraint({ constraint: "not_an_error" })).toBeNull();
  });

  /**
   * A caller compares the result against a known name (`CHAIN_INDEXES`, `TEAMS_BID_CODE_UNIQUE`), so
   * a non-string `constraint` must not be coerced into one that accidentally matches.
   */
  it("ignores a constraint that is not a string", () => {
    const odd = Object.assign(new Error("nope"), { constraint: 23505 });

    expect(violatedConstraint(odd)).toBeNull();
  });
});
