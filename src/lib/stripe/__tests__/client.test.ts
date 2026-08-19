import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "../client";

const SECRET = "whsec_test_secret_value";
const PAYLOAD = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });

const sign = (payload: string, at: number, secret = SECRET): string =>
  `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${payload}`).digest("hex")}`;

/**
 * The webhook endpoint is unauthenticated by necessity — Stripe has no cookie — so this signature is
 * the only thing between it and anybody who can POST a `payment_intent.succeeded` and have the
 * ledger record money that never arrived. Every refusal below is a way in if it stops working.
 */
describe("verifySignature", () => {
  const now = 1_800_000_000;

  it("accepts a signature Stripe would actually send", () => {
    expect(verifySignature(PAYLOAD, sign(PAYLOAD, now), SECRET, now)).toBe(true);
  });

  it("refuses a missing header, which is the unsigned POST", () => {
    expect(verifySignature(PAYLOAD, null, SECRET, now)).toBe(false);
    expect(verifySignature(PAYLOAD, "", SECRET, now)).toBe(false);
  });

  it("refuses a signature made with a different secret", () => {
    expect(verifySignature(PAYLOAD, sign(PAYLOAD, now, "whsec_someone_else"), SECRET, now)).toBe(
      false,
    );
  });

  it("refuses a body that was edited after signing — the amount is in the body", () => {
    const header = sign(PAYLOAD, now);
    const tampered = PAYLOAD.replace("evt_1", "evt_2");
    expect(verifySignature(tampered, header, SECRET, now)).toBe(false);
  });

  /**
   * A valid signature replayed a week later is still a valid signature, so the timestamp is part of
   * what is signed and part of what is checked. Without this, one captured request is a permanent
   * ability to re-fire it.
   */
  it("refuses a valid signature that is too old, and one from the future", () => {
    expect(verifySignature(PAYLOAD, sign(PAYLOAD, now - 3600), SECRET, now)).toBe(false);
    expect(verifySignature(PAYLOAD, sign(PAYLOAD, now + 3600), SECRET, now)).toBe(false);
    // Inside the tolerance, both directions, because clocks drift.
    expect(verifySignature(PAYLOAD, sign(PAYLOAD, now - 120), SECRET, now)).toBe(true);
    expect(verifySignature(PAYLOAD, sign(PAYLOAD, now + 120), SECRET, now)).toBe(true);
  });

  it("refuses a header that is malformed rather than wrong", () => {
    for (const header of [
      "v1=deadbeef",
      `t=${now}`,
      "t=notanumber,v1=deadbeef",
      `t=${now},v1=`,
      "garbage",
    ]) {
      expect(verifySignature(PAYLOAD, header, SECRET, now)).toBe(false);
    }
  });

  it("refuses a truncated signature rather than comparing a prefix", () => {
    const full = sign(PAYLOAD, now);
    const truncated = full.slice(0, full.length - 10);
    expect(verifySignature(PAYLOAD, truncated, SECRET, now)).toBe(false);
  });

  it("reads v1 even when Stripe sends other schemes alongside it", () => {
    const header = `${sign(PAYLOAD, now)},v0=ignored`;
    expect(verifySignature(PAYLOAD, header, SECRET, now)).toBe(true);
  });
});
