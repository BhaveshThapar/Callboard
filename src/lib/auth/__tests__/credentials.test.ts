import { describe, expect, it } from "vitest";
import {
  checkPassword,
  isEmail,
  isLive,
  normalizeEmail,
  PASSWORD_MAX,
  PASSWORD_MIN,
  sessionExpiry,
} from "../credentials";

const AT = new Date("2027-02-20T18:00:00Z");

describe("normalizeEmail", () => {
  it("makes the same address the same account", () => {
    expect(normalizeEmail("  Ananya@Example.COM ")).toBe("ananya@example.com");
  });

  /**
   * Gmail ignores dots and `+tags`; a university mail server generally does not. Normalizing beyond
   * the standard would merge two addresses that the mail host considers two people — and merging two
   * humans into one login is a worse failure than asking somebody to type carefully.
   */
  it("does not merge addresses the mail host would keep apart", () => {
    expect(normalizeEmail("a.b+comp@umd.edu")).toBe("a.b+comp@umd.edu");
  });
});

describe("isEmail", () => {
  it("accepts an ordinary address", () => {
    expect(isEmail("ananya@example.com")).toBe(true);
    expect(isEmail("a.b+comp@terpmail.umd.edu")).toBe(true);
  });

  /**
   * A false reject stops a signup and the person tells you. A false accept puts an unreachable
   * address on the account dues reminders are sent to, and nobody finds out until a team is chased
   * for money it was never asked for. These are the shapes that would do that.
   */
  it("refuses the shapes that would silently swallow a reminder", () => {
    for (const bad of ["", "ananya", "ananya@", "@example.com", "a b@example.com", "a@b"]) {
      expect(isEmail(bad), bad).toBe(false);
    }
  });
});

describe("checkPassword", () => {
  it("accepts a passphrase", () => {
    expect(checkPassword("correct horse battery staple").ok).toBe(true);
  });

  it("refuses one that is too short, and says the rule rather than the failure", () => {
    const result = checkPassword("short");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain(String(PASSWORD_MIN));
    expect(result.message).toMatch(/sentence/);
  });

  it("refuses one long enough to make hashing a denial of service", () => {
    expect(checkPassword("x".repeat(PASSWORD_MAX + 1)).ok).toBe(false);
  });

  /**
   * The rule is length and nothing else. Composition rules push people toward `Password1!` and away
   * from a passphrase, which is the opposite of what they are for. If this test ever fails because
   * somebody added a symbol requirement, the requirement is the bug.
   */
  it("has no character-class rule", () => {
    expect(checkPassword("aaaaaaaaaaaaaaaa").ok).toBe(true);
  });
});

describe("isLive", () => {
  const future = sessionExpiry(AT);

  it("is live when it has not expired, been revoked, or been spent", () => {
    expect(isLive({ expiresAt: future }, AT)).toBe(true);
  });

  it("is dead once revoked, which is the property a JWT could not have given us", () => {
    expect(isLive({ expiresAt: future, revokedAt: AT }, AT)).toBe(false);
  });

  it("is dead once accepted, because an invitation is spent exactly once", () => {
    expect(isLive({ expiresAt: future, acceptedAt: AT }, AT)).toBe(false);
  });

  /** `<=`, not `<`: expiring exactly now is expired, or there is a one-tick window to land on. */
  it("is dead at exactly its expiry, not a tick later", () => {
    expect(isLive({ expiresAt: AT }, AT)).toBe(false);
    expect(isLive({ expiresAt: new Date(AT.getTime() + 1) }, AT)).toBe(true);
  });

  it("reads null and undefined the same way, since one comes from a row and one from a literal", () => {
    expect(isLive({ expiresAt: future, revokedAt: null, acceptedAt: null }, AT)).toBe(true);
    expect(isLive({ expiresAt: future }, AT)).toBe(true);
  });
});
