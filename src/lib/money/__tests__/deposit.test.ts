import { describe, expect, it } from "vitest";
import type { DepositState } from "../deposit";
import {
  DEPOSIT_STATES,
  TERMINAL_STATES,
  allowedFrom,
  canTransition,
  currentState,
  isTerminal,
} from "../deposit";

describe("the deposit machine", () => {
  it("is total, so a state added later cannot silently have no rules", () => {
    for (const state of DEPOSIT_STATES) {
      expect(allowedFrom(state)).toBeDefined();
    }
  });

  it("lets a held deposit be returned or kept", () => {
    expect(canTransition("held", "refund_pending")).toBe(true);
    expect(canTransition("held", "forfeited")).toBe(true);
  });

  it("does not let a held deposit jump straight to refunded", () => {
    // Money that has not been sent has not arrived. The pending step is the sending.
    expect(canTransition("held", "refunded")).toBe(false);
  });

  /**
   * The edge worth arguing. An ACH return that bounced is a thing to retry, and calling it terminal
   * would strand the money in a state the product cannot leave — a treasurer looking at a deposit
   * marked finished that is still in the org's account.
   */
  it("treats a failed refund as retryable, not as an ending", () => {
    expect(isTerminal("refund_failed")).toBe(false);
    expect(canTransition("refund_failed", "held")).toBe(true);
    expect(canTransition("refund_pending", "refund_failed")).toBe(true);
  });

  it("lets a bounced refund be forfeited instead of retried", () => {
    expect(canTransition("refund_failed", "forfeited")).toBe(true);
  });

  it("has exactly two endings, and neither leads anywhere", () => {
    expect([...TERMINAL_STATES]).toEqual(["refunded", "forfeited"]);
    for (const state of TERMINAL_STATES) {
      expect(isTerminal(state)).toBe(true);
      expect(allowedFrom(state)).toEqual([]);
    }
  });

  it("refuses every transition out of an ending", () => {
    for (const from of TERMINAL_STATES) {
      for (const to of DEPOSIT_STATES) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("never allows a deposit to end twice through the graph", () => {
    // The database refuses it too (`deposit_events_terminal_unique`), and both must be true: the
    // index catches a race the graph cannot see, and the graph catches a click the index would
    // have to reject with a constraint error.
    for (const from of TERMINAL_STATES) {
      for (const to of TERMINAL_STATES) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });
});

describe("currentState", () => {
  const event = (seq: number, state: DepositState) => ({ seq, state });

  /**
   * Not a default standing in for missing data: a deposit that has been charged and paid and not
   * yet resolved *is* held, and writing a row to say so would record an event that never happened.
   */
  it("is held for a chain nothing has happened to", () => {
    expect(currentState([])).toBe("held");
  });

  it("is the last row by seq, not the last one returned", () => {
    // Rows arrive in whatever order the query gave them; `seq` is what orders the chain.
    expect(currentState([event(3, "refunded"), event(1, "held"), event(2, "refund_pending")])).toBe(
      "refunded",
    );
  });

  it("follows a retry back out of failure", () => {
    expect(
      currentState([
        event(1, "refund_pending"),
        event(2, "refund_failed"),
        event(3, "held"),
        event(4, "refund_pending"),
        event(5, "refunded"),
      ]),
    ).toBe("refunded");
  });
});
