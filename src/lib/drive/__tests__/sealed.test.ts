import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sameSecret, seal, unseal } from "../sealed";

const KEY = randomBytes(32);
const OTHER = randomBytes(32);

describe("seal / unseal", () => {
  it("round-trips a refresh token", () => {
    const sealed = seal("1//0eXampleRefreshToken", KEY);
    expect(sealed.ok).toBe(true);
    const opened = sealed.ok ? unseal(sealed.sealed, KEY) : null;
    expect(opened?.ok && opened.value).toBe("1//0eXampleRefreshToken");
  });

  it("keeps the algorithm in the value, so a later cipher is a re-seal and not a flag day", () => {
    const sealed = seal("secret", KEY);
    expect(sealed.ok && sealed.sealed.startsWith("aes-256-gcm$")).toBe(true);
    expect(sealed.ok && sealed.sealed.split("$")).toHaveLength(4);
  });

  it("never emits the plaintext", () => {
    const sealed = seal("1//0eXampleRefreshToken", KEY);
    expect(sealed.ok && sealed.sealed).not.toContain("RefreshToken");
  });

  it("uses a fresh IV, so the same token twice does not produce the same ciphertext", () => {
    const a = seal("same", KEY);
    const b = seal("same", KEY);
    expect(a.ok && b.ok && a.sealed).not.toBe(b.ok ? b.sealed : "");
  });

  /**
   * GCM rather than CBC is the whole point: a tampered value must fail loudly, not decrypt to
   * rubbish that then gets replayed at Google.
   */
  it("refuses a tampered ciphertext rather than returning garbage", () => {
    const sealed = seal("secret", KEY);
    if (!sealed.ok) throw new Error("seal failed");

    const parts = sealed.sealed.split("$");
    const bytes = Buffer.from(parts[3]!, "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    parts[3] = bytes.toString("base64");

    const opened = unseal(parts.join("$"), KEY);
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.reason).toContain("Reconnect");
  });

  it("refuses a tampered auth tag", () => {
    const sealed = seal("secret", KEY);
    if (!sealed.ok) throw new Error("seal failed");
    const parts = sealed.sealed.split("$");
    parts[2] = Buffer.alloc(16).toString("base64");
    expect(unseal(parts.join("$"), KEY).ok).toBe(false);
  });

  it("refuses the wrong key", () => {
    const sealed = seal("secret", KEY);
    expect(sealed.ok && unseal(sealed.sealed, OTHER).ok).toBe(false);
  });

  it("refuses a value this build cannot parse rather than throwing", () => {
    expect(unseal("not-sealed-at-all", KEY).ok).toBe(false);
    expect(unseal("rot13$a$b$c", KEY).ok).toBe(false);
  });

  /**
   * Absence is a refusal, never a fallback. A deployment with no key must fail to connect an
   * account rather than quietly storing a refresh token in the clear.
   */
  it("refuses to seal without a key instead of storing plaintext", () => {
    const sealed = seal("secret", null);
    expect(sealed.ok).toBe(false);
    expect(!sealed.ok && sealed.reason).toContain("DRIVE_TOKEN_KEY");
  });

  it("refuses to unseal without a key", () => {
    expect(unseal("aes-256-gcm$a$b$c", null).ok).toBe(false);
  });
});

describe("sameSecret", () => {
  it("matches identical values and rejects everything else", () => {
    expect(sameSecret("abc123", "abc123")).toBe(true);
    expect(sameSecret("abc123", "abc124")).toBe(false);
    expect(sameSecret("abc123", "abc1234")).toBe(false);
    expect(sameSecret("", "")).toBe(true);
    expect(sameSecret("abc", "")).toBe(false);
  });

  it("does not throw on a length mismatch, which is what timingSafeEqual does alone", () => {
    expect(() => sameSecret("short", "a much longer value")).not.toThrow();
  });
});
