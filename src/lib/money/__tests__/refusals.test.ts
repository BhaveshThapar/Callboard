import { describe, expect, it } from "vitest";
import { MONEY_CONSTRAINTS } from "@/db/schema/money";
import { refusalFor, UNKNOWN_REFUSAL } from "../refusals";

/**
 * The ledger's third-reader claim, finally testable.
 *
 * `src/lib/money/ledger.ts` had **no unit test at all**, and not through neglect: it imports `@/db`,
 * which reads `DATABASE_URL` the moment the module loads, so any test importing it threw before
 * reaching an assertion. The mapping most worth testing was the one least in need of a database, and
 * it was locked inside the one file that could not have one. Splitting it out is the fix; this file
 * is what the split was for.
 *
 * What is being held here is CLAUDE.md's rule that **a database error is read by its `constraint`,
 * never by its message** — and its consequence, that a treasurer reconciling a bank statement is
 * never shown `Failed query: insert into "payments" ...`.
 */

/** The shape drizzle actually throws: the driver's error, wrapped, with the name on `cause`. */
const wrapped = (constraint: string): Error =>
  Object.assign(new Error('Failed query: insert into "payments" ...'), {
    cause: Object.assign(new Error("duplicate key value violates unique constraint"), { constraint }),
  });

describe("refusalFor", () => {
  it("turns the allocation ceiling into a sentence about what is left", () => {
    const message = refusalFor(wrapped(MONEY_CONSTRAINTS.allocatedCeiling));
    expect(message).toMatch(/more than this payment is worth/);
    expect(message).toMatch(/reload and check what is left/);
  });

  it("turns the net identity into a sentence about what the bank shows", () => {
    expect(refusalFor(wrapped(MONEY_CONSTRAINTS.netIdentity))).toMatch(/gross minus fee/);
  });

  it("says a re-imported reference was not recorded twice", () => {
    expect(refusalFor(wrapped(MONEY_CONSTRAINTS.externalRef))).toMatch(/not been recorded twice/);
  });

  /**
   * This sentence used to end *"adjust the existing allocation instead"*, naming an instrument that
   * did not exist: `releaseAllocation` had no caller, so there was no way to adjust one. It now
   * names the button that is actually on the screen.
   */
  it("points a duplicate allocation at the release that now exists", () => {
    const message = refusalFor(wrapped(MONEY_CONSTRAINTS.liveAllocation));
    expect(message).toMatch(/already applied to that charge/);
    expect(message).toMatch(/Release the existing allocation/);
  });

  it("turns the refund ceiling into a sentence about what came in", () => {
    expect(refusalFor(wrapped(MONEY_CONSTRAINTS.refundedCeiling))).toMatch(/ever brought in/);
  });

  /** Every constraint the schema names has a sentence. A new one must not fall through to null. */
  it("has a sentence for every money constraint", () => {
    for (const name of Object.values(MONEY_CONSTRAINTS)) {
      // The deposit terminal is the one exception and is handled by `advanceDeposit`, which means
      // something different by it: a second *ending*, not a bad number.
      if (name === MONEY_CONSTRAINTS.depositTerminal) continue;
      expect(refusalFor(wrapped(name)), name).toBeTruthy();
    }
  });

  it("returns null for a constraint it does not know, so the caller says UNKNOWN instead", () => {
    expect(refusalFor(wrapped("teams_comp_bid_code_unique"))).toBeNull();
  });

  /**
   * The failure this exists to prevent. A bare error carries no constraint, so there is nothing to
   * read — and the caller must fall back to a sentence rather than to drizzle's `message`, which is
   * the failed SQL.
   */
  it("returns null for an error with no constraint at all", () => {
    expect(refusalFor(new Error("connection reset"))).toBeNull();
    expect(refusalFor(undefined)).toBeNull();
    expect(UNKNOWN_REFUSAL).not.toMatch(/Failed query/);
    expect(UNKNOWN_REFUSAL).toMatch(/Nothing was saved/);
  });
});
