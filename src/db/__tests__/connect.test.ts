import { describe, expect, it } from "vitest";
import { retryingFetch } from "../connect";
import { neverArrived } from "../errors";

/** What Node's `fetch` actually throws: a bare TypeError with the real cause underneath. */
const fetchFailure = (code: string): Error =>
  new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });

const ok = new Response("{}", { status: 200 });

/** Counts calls, so the no-retry rule is proved by arithmetic rather than by a stopwatch. */
const counting = (...outcomes: (Error | Response)[]) => {
  let calls = 0;
  const send = (async () => {
    const outcome = outcomes[Math.min(calls++, outcomes.length - 1)]!;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }) as unknown as typeof fetch;
  return { send, calls: () => calls };
};

describe("neverArrived", () => {
  it("finds the code under the TypeError fetch throws, not in its message", () => {
    expect(neverArrived(fetchFailure("ENOTFOUND"))).toBe(true);
    // The message is "fetch failed" either way, which is why the code is the only safe thing to read.
    expect(fetchFailure("ECONNRESET").message).toBe(fetchFailure("ENOTFOUND").message);
  });

  it("refuses ECONNRESET, because an insert may have committed before the response was lost", () => {
    expect(neverArrived(fetchFailure("ECONNRESET"))).toBe(false);
  });

  it("refuses a timeout, which is equally ambiguous about whether the statement ran", () => {
    expect(neverArrived(fetchFailure("ETIMEDOUT"))).toBe(false);
  });

  it("is false for a database error that genuinely arrived", () => {
    expect(neverArrived(new Error("duplicate key value violates unique constraint"))).toBe(false);
    expect(neverArrived(null)).toBe(false);
  });
});

describe("retryingFetch", () => {
  it("sends a DNS failure again and returns the answer it eventually gets", async () => {
    const { send, calls } = counting(fetchFailure("ENOTFOUND"), ok);
    await expect(retryingFetch(send)("https://example.test/sql")).resolves.toBe(ok);
    expect(calls()).toBe(2);
  });

  it("does not retry a reset — one call, and the error reaches the caller", async () => {
    const { send, calls } = counting(fetchFailure("ECONNRESET"));
    await expect(retryingFetch(send)("https://example.test/sql")).rejects.toThrow("fetch failed");
    expect(calls()).toBe(1);
  });

  it("gives up after the attempt limit rather than absorbing an outage", async () => {
    const { send, calls } = counting(fetchFailure("ENOTFOUND"));
    await expect(retryingFetch(send, 3)("https://example.test/sql")).rejects.toThrow("fetch failed");
    expect(calls()).toBe(3);
  });

  it("costs nothing when the first call succeeds", async () => {
    const { send, calls } = counting(ok);
    await expect(retryingFetch(send)("https://example.test/sql")).resolves.toBe(ok);
    expect(calls()).toBe(1);
  });

  it("passes the request through untouched, since neon builds it", async () => {
    let seen: unknown[] = [];
    const send = (async (...args: unknown[]) => {
      seen = args;
      return ok;
    }) as unknown as typeof fetch;
    await retryingFetch(send)("https://example.test/sql", { method: "POST" });
    expect(seen).toEqual(["https://example.test/sql", { method: "POST" }]);
  });
});
