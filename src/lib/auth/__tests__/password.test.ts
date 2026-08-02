import { randomBytes, scrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../password";

/**
 * scrypt at OWASP's floor is deliberately slow — that is the feature — so this file is small on
 * purpose and each case earns its ~100ms.
 */

describe("hashPassword / verifyPassword", () => {
  it("round-trips", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect((await verifyPassword("correct horse battery staple", stored)).ok).toBe(true);
    expect((await verifyPassword("Correct horse battery staple", stored)).ok).toBe(false);
  });

  it("salts, so two accounts with one password do not share a hash", async () => {
    const a = await hashPassword("the same password");
    const b = await hashPassword("the same password");
    expect(a).not.toBe(b);
    expect((await verifyPassword("the same password", b)).ok).toBe(true);
  });

  /**
   * The algorithm and its cost live in the stored string so that raising `N` later is a rehash on
   * next login rather than a flag day. If this stops being true, every account is locked out by the
   * first cost increase.
   */
  it("carries its algorithm and parameters, so the cost can be raised later", async () => {
    const stored = await hashPassword("a passphrase that is long enough");
    const [algorithm, n, r, p] = stored.split("$");
    expect(algorithm).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(1 << 17);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  /**
   * The upgrade path, and the reason it is tested by *building* an old hash rather than by editing a
   * new one: the cost is an input to the derivation, so a hash with `N` rewritten in the string is
   * not an old hash, it is a corrupt one. This constructs a genuinely cheaper hash the way a previous
   * version of the module would have, which also makes the stored format a real contract rather than
   * an implementation detail two functions happen to agree on.
   */
  it("verifies a hash written under an older cost, and says it needs a rehash", async () => {
    const password = "a passphrase that is long enough";
    const salt = randomBytes(16);
    const oldN = 1 << 14;
    const key: Buffer = await new Promise((resolve, reject) => {
      scrypt(password.normalize("NFKC"), salt, 64, { N: oldN, r: 8, p: 1 }, (error, derived) =>
        error ? reject(error) : resolve(derived),
      );
    });
    const old = `scrypt$${oldN}$8$1$${salt.toString("base64")}$${key.toString("base64")}`;

    const result = await verifyPassword(password, old);
    expect(result.ok).toBe(true);
    expect(result.needsRehash).toBe(true);

    // And a hash at the current cost does not ask to be rewritten every single login.
    const current = await verifyPassword(password, await hashPassword(password));
    expect(current).toEqual({ ok: true, needsRehash: false });
  });

  /**
   * A corrupted row is a failed login, never a thrown error. A 500 here would tell whoever caused it
   * that they had found something worth causing.
   */
  it("refuses a malformed stored value instead of throwing", async () => {
    for (const bad of ["", "nonsense", "scrypt$1$2$3", "argon2$1$2$3$c2FsdA==$aGFzaA==", "$$$$$"]) {
      await expect(verifyPassword("whatever", bad), bad).resolves.toEqual({
        ok: false,
        needsRehash: false,
      });
    }
  });

  /** A hostile row must not be able to ask this process for an unbounded amount of memory. */
  it("refuses a stored value demanding more work than the current parameters", async () => {
    const stored = await hashPassword("a passphrase that is long enough");
    const inflated = stored.replace(/^scrypt\$\d+/, `scrypt$${1 << 24}`);
    expect((await verifyPassword("a passphrase that is long enough", inflated)).ok).toBe(false);
  });

  /** Unicode normalization, so a password typed on two keyboards is one password. */
  it("normalizes, so the same characters composed differently still match", async () => {
    const stored = await hashPassword("mañana is a long enough password");
    expect((await verifyPassword("mañana is a long enough password", stored)).ok).toBe(true);
  });
});
