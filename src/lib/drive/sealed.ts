import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The one place in this repo that stores a secret it can read back, and the argument for why.
 *
 * Everything else here **hashes**: a judge link, a board link, a session and an invitation are 32
 * random bytes whose sha256 is stored and whose raw value is never kept, and a password is scrypt.
 * That works because the product only ever has to *recognise* those, never reproduce them. A Google
 * refresh token is the opposite: its whole purpose is to be replayed at Google months later, so it
 * cannot be hashed, and "do not store recoverable secrets" stops being available as a rule.
 *
 * It is also the opposite of [ADR-0021](../../../docs/decisions/0021-the-outbox-holds-a-secret-only-until-it-sends.md),
 * which keeps the outbox's one credential *only until it sends*. A refresh token is long-lived by
 * definition; there is no send to scrub after. So the mitigation has to be encryption at rest plus a
 * projection that never selects it -- `DriveConnectionView` carries the account's email and not the
 * token, so a page cannot leak what it cannot name.
 *
 * **The algorithm is data**, exactly as `password.ts` argues: a sealed value is
 * `aes-256-gcm$iv$tag$ciphertext`, so changing cipher later re-seals on next use rather than
 * requiring a flag day. GCM rather than CBC because this must detect tampering, not merely hide the
 * value: a modified ciphertext must fail loudly rather than decrypt to rubbish that gets sent to
 * Google.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export type SealResult = { ok: true; sealed: string } | { ok: false; reason: string };
export type UnsealResult = { ok: true; value: string } | { ok: false; reason: string };

/**
 * The key, or a stated absence.
 *
 * Drive import is **opt-in on this being set**, the same shape comms uses for `RESEND_API_KEY`: a
 * deployment without it cannot connect an account rather than storing a token in the clear. A
 * preview deployment that silently kept plaintext refresh tokens would be the worst possible
 * default, so the absence is a refusal and never a fallback.
 */
const sealingKey = (): Buffer | null => {
  const raw = process.env.DRIVE_TOKEN_KEY;
  if (!raw) return null;

  const key = Buffer.from(raw, "base64");
  // A short key is a misconfiguration that would otherwise throw deep inside `createCipheriv` at the
  // moment somebody connects an account. Better to answer "not configured" the same way as absent.
  return key.length === KEY_BYTES ? key : null;
};

export const sealingConfigured = (): boolean => sealingKey() !== null;

export const seal = (plaintext: string, key: Buffer | null = sealingKey()): SealResult => {
  if (!key) return { ok: false, reason: "DRIVE_TOKEN_KEY is not set on this deployment." };

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ok: true,
    sealed: [
      ALGORITHM,
      iv.toString("base64"),
      tag.toString("base64"),
      ciphertext.toString("base64"),
    ].join("$"),
  };
};

export const unseal = (sealed: string, key: Buffer | null = sealingKey()): UnsealResult => {
  if (!key) return { ok: false, reason: "DRIVE_TOKEN_KEY is not set on this deployment." };

  const parts = sealed.split("$");
  if (parts.length !== 4 || parts[0] !== ALGORITHM) {
    return { ok: false, reason: "That stored credential is not in a format this build understands." };
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parts[1] ?? "", "base64"));
    decipher.setAuthTag(Buffer.from(parts[2] ?? "", "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parts[3] ?? "", "base64")),
      decipher.final(),
    ]);
    return { ok: true, value: plaintext.toString("utf8") };
  } catch {
    // `final()` is what throws when the tag does not match, which is tampering or the wrong key.
    // Both mean the same thing to a caller: this connection has to be made again.
    return { ok: false, reason: "That stored credential could not be read. Reconnect the account." };
  }
};

/**
 * Constant-time comparison for the OAuth `state` value.
 *
 * Lives here rather than in the route because a `===` on a CSRF token is the kind of thing that
 * passes review by looking obvious. Lengths are compared first because `timingSafeEqual` throws on a
 * mismatch, and that throw is itself an early exit.
 */
export const sameSecret = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};
