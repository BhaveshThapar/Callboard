import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NOT_SENDING, sendingCaveat, sendingConfigured, transportFromEnv } from "../transport";

const KEYS = ["RESEND_API_KEY", "COMMS_FROM"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const configured = () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.COMMS_FROM = "board@example.com";
};

describe("sending is opt-in", () => {
  it("takes a key and a from-address, and anything less records", () => {
    expect(transportFromEnv().name).toBe("recording");

    process.env.RESEND_API_KEY = "re_test";
    expect(transportFromEnv().name, "a key alone is not enough").toBe("recording");

    delete process.env.RESEND_API_KEY;
    process.env.COMMS_FROM = "board@example.com";
    expect(transportFromEnv().name, "an address alone is not enough").toBe("recording");

    configured();
    expect(transportFromEnv().name).toBe("resend");
  });

  it("derives the predicate from the same two variables, so the screen cannot disagree", () => {
    expect(sendingConfigured()).toBe(false);
    expect(transportFromEnv().name).toBe("recording");

    configured();
    expect(sendingConfigured()).toBe(true);
    expect(transportFromEnv().name).toBe("resend");
  });
});

describe("the caveat a board needs before it closes the tab", () => {
  it("warns when something was queued and nothing will carry it", () => {
    expect(sendingCaveat(true)).toContain(NOT_SENDING);
  });

  it("says nothing when the queue will actually drain", () => {
    configured();
    expect(sendingCaveat(true)).toBe("");
  });

  /**
   * The caveat is about *this* action, not about the deployment. A board that queued nothing --
   * every team already reminded this month, or a forfeit, which sends deliberately -- is not
   * told about a transport it did not just use.
   */
  it("says nothing when this action queued nothing", () => {
    expect(sendingCaveat(false)).toBe("");
    configured();
    expect(sendingCaveat(false)).toBe("");
  });

  it("starts with a space, because it is appended to a sentence", () => {
    expect(sendingCaveat(true).startsWith(" ")).toBe(true);
  });
});
