import { describe, expect, it } from "vitest";
import { MESSAGE_STATES, MESSAGE_TERMINAL_STATES } from "@/db/schema/comms";
import type { MessageState } from "@/db/schema/comms";
import {
  allowedFrom,
  backoffMs,
  canTransition,
  currentState,
  isDue,
  isStuck,
  isTerminal,
  MAX_ATTEMPTS,
  STUCK_AFTER_MS,
} from "../state";

const AT = new Date("2027-02-20T18:00:00Z");
const due = (over: Partial<Parameters<typeof isDue>[0]> = {}) => ({
  state: "queued" as MessageState,
  sendAfter: AT,
  attempts: 0,
  ...over,
});

describe("the message machine", () => {
  it("is total, so a state added later cannot silently have no rules", () => {
    for (const state of MESSAGE_STATES) {
      expect(allowedFrom(state), state).toBeDefined();
    }
  });

  it("ends at sent and at bounced, and nowhere else", () => {
    for (const state of MESSAGE_STATES) {
      expect(isTerminal(state), state).toBe(
        (MESSAGE_TERMINAL_STATES as readonly string[]).includes(state),
      );
      if (isTerminal(state)) expect(allowedFrom(state)).toEqual([]);
    }
  });

  /**
   * `failed` is not an ending, for `refund_failed`'s reason: a timed-out connection to a mail
   * provider is the network being bad, not the address being wrong, and calling it terminal strands
   * a dues reminder nobody can ever send.
   */
  it("treats a failed send as retryable and a bounce as final", () => {
    expect(isTerminal("failed")).toBe(false);
    expect(canTransition("failed", "sending")).toBe(true);
    expect(isTerminal("bounced")).toBe(true);
    expect(canTransition("bounced", "sending")).toBe(false);
  });

  /**
   * Going back to `queued` would make the claim reversible, and the claim is the only thing stopping
   * two workers sending the same row. A retry starts from `failed`, which only a *resolved* attempt
   * can reach.
   */
  it("never returns to queued, because the claim must not be reversible", () => {
    for (const state of MESSAGE_STATES) {
      expect(canTransition(state, "queued"), state).toBe(false);
    }
  });

  it("cannot be claimed twice in a row", () => {
    expect(canTransition("sending", "sending")).toBe(false);
  });
});

describe("currentState", () => {
  it("is queued for a message nothing has happened to yet", () => {
    expect(currentState([])).toBe("queued");
  });

  /** By `seq`, not by arrival: two events written in one act share a timestamp. */
  it("is the last row by seq, not the last one returned", () => {
    expect(
      currentState([
        { seq: 3, state: "sent" },
        { seq: 1, state: "queued" },
        { seq: 2, state: "sending" },
      ]),
    ).toBe("sent");
  });
});

describe("isDue", () => {
  it("claims a queued message whose time has come", () => {
    expect(isDue(due(), AT)).toBe(true);
  });

  it("leaves a message queued for later alone", () => {
    expect(isDue(due({ sendAfter: new Date(AT.getTime() + 1) }), AT)).toBe(false);
  });

  it("retries a failed one and never a sent one", () => {
    expect(isDue(due({ state: "failed" }), AT)).toBe(true);
    expect(isDue(due({ state: "sent" }), AT)).toBe(false);
    expect(isDue(due({ state: "bounced" }), AT)).toBe(false);
  });

  /**
   * A message already claimed is not due, and this is the assertion that matters most in the file:
   * it is the difference between a cron tick that retries the network and one that emails somebody
   * a second time.
   */
  it("never claims one that is already being sent", () => {
    expect(isDue(due({ state: "sending" }), AT)).toBe(false);
  });

  it("stops retrying once it has failed enough times to be a human's problem", () => {
    expect(isDue(due({ state: "failed", attempts: MAX_ATTEMPTS - 1 }), AT)).toBe(true);
    expect(isDue(due({ state: "failed", attempts: MAX_ATTEMPTS }), AT)).toBe(false);
  });
});

describe("backoffMs", () => {
  it("grows, so a provider that is down is not hammered", () => {
    expect(backoffMs(1)).toBeGreaterThan(backoffMs(0));
    expect(backoffMs(3)).toBeGreaterThan(backoffMs(2));
  });

  it("is capped, so a retry never lands a week later", () => {
    expect(backoffMs(99)).toBe(6 * 3_600_000);
  });

  it("treats a negative attempt count as zero rather than returning a fraction", () => {
    expect(backoffMs(-5)).toBe(backoffMs(0));
  });
});

describe("isStuck", () => {
  const claimed = (msAgo: number) => ({
    state: "sending" as MessageState,
    claimedAt: new Date(AT.getTime() - msAgo),
  });

  it("is not stuck while a send is plausibly still in flight", () => {
    expect(isStuck(claimed(1_000), AT)).toBe(false);
  });

  /**
   * This is the crash-after-send footprint: claimed, never resolved. It is reported rather than
   * retried, because retrying emails somebody twice and a duplicate is invisible from inside the
   * system — two identical rows and one row look the same on every screen.
   */
  it("is stuck once a claim has outlived any real send", () => {
    expect(isStuck(claimed(STUCK_AFTER_MS + 1), AT)).toBe(true);
  });

  it("is never stuck in a state that was never claimed", () => {
    expect(isStuck({ state: "queued", claimedAt: null }, AT)).toBe(false);
    expect(isStuck({ state: "sent", claimedAt: new Date(0) }, AT)).toBe(false);
  });
});
