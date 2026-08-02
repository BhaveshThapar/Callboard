import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing, with no dependency and no cleverness ([ADR-0016]).
 *
 * scrypt from `node:crypto` rather than argon2id: argon2 in Node is a native module, this repo has
 * five runtime dependencies, and it deploys to serverless functions. OWASP lists scrypt as an
 * acceptable choice at `N=2^17, r=8, p=1`, which is what this uses, and the margin argon2 would buy
 * is one no attacker of a student comp's roster is anywhere near.
 *
 * **The algorithm is data.** A stored value is `scrypt$N$r$p$salt$hash`, so moving to argon2 later is
 * a rehash on next login behind a version check rather than a flag day that logs everybody out. That
 * is the whole reason the parameters are in the string instead of only in this file: a hash written
 * under one cost has to stay verifiable after the cost is raised.
 *
 * [ADR-0016]: ../../../docs/decisions/0016-accounts-for-people-who-stay-links-for-people-who-visit.md
 */
/** OWASP's floor for scrypt. `N` is the work factor; raising it invalidates nothing (see above). */
const N = 1 << 17;
const R = 8;
const P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/** `maxmem` must exceed roughly `128 * N * r`, and Node's 32MB default is under it at N=2^17. */
const MAX_MEM = 256 * N * R;

/**
 * Hand-wrapped rather than `promisify(scrypt)`, whose overloads resolve to the three-argument form
 * and lose the options object — which is where every parameter that matters lives.
 */
const derive = (password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_BYTES,
      { N: n, r, p, maxmem: 256 * n * r },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
};

/**
 * Verifies, and says whether the stored hash is behind the current cost.
 *
 * Two answers rather than one because a login is the only moment a plaintext password exists, and
 * therefore the only moment an old hash can be upgraded. Returning `needsRehash` here is what makes
 * raising `N` a thing that happens gradually instead of a thing nobody ever does.
 *
 * **Never throws on a malformed stored value** — it returns `false`. A row with a corrupted hash is a
 * failed login, not a 500 that tells an attacker they found something interesting.
 */
export const verifyPassword = async (
  password: string,
  stored: string,
): Promise<{ ok: boolean; needsRehash: boolean }> => {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return { ok: false, needsRehash: false };

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return { ok: false, needsRehash: false };
  }
  // A hostile row must not be able to ask this process for an arbitrary amount of memory.
  if (n > N || r > R * 4 || p > P * 4) return { ok: false, needsRehash: false };

  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (salt.length === 0 || expected.length !== KEY_BYTES) return { ok: false, needsRehash: false };

  const actual = await derive(password, salt, n, r, p);
  // Constant time, and only after the lengths are known equal -- `timingSafeEqual` throws otherwise.
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
  return { ok, needsRehash: ok && (n !== N || r !== R || p !== P) };
};

/**
 * Burns roughly the time a real verification would, so a login against an unknown email costs what a
 * login against a known one costs.
 *
 * Without this, "no such account" returns in a millisecond and "wrong password" returns in a hundred,
 * which turns the login form into an oracle for whether a given person has an account here. That
 * matters more than usual for this product: the emails are a board roster, and knowing who is on it
 * is itself worth something to somebody.
 */
export const burnPasswordTime = async (): Promise<void> => {
  await derive("no such account", randomBytes(SALT_BYTES), N, R, P);
};

export const SCRYPT_PARAMS = { N, R, P, KEY_BYTES, MAX_MEM } as const;
