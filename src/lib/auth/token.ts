import { createHash, randomBytes } from "node:crypto";

/**
 * Access tokens for judges and for a comp's board view. The raw token exists only in the URL
 * we hand out; the database stores its sha256. Revoking is a write, not a password reset.
 */
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const createToken = (): { token: string; tokenHash: string } => {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
};
