import { cookies } from "next/headers";

/**
 * Where a session token lives on the way back to the browser.
 *
 * `httpOnly` so a script cannot read it, `secure` outside development, and `sameSite: lax` rather
 * than `strict`: `strict` would drop the cookie on the first click of an emailed invitation link,
 * which is the one journey this whole feature exists to make work.
 *
 * `maxAge` matches the row's own expiry rather than approximating it, but the **row** is the
 * authority: a cookie that outlives its session resolves to nothing, and a revoked session is dead
 * the moment it is revoked no matter what the browser is still holding. That asymmetry is the point
 * of sessions being rows at all (ADR-0016).
 */
export const SESSION_COOKIE = "callboard_session";

export const setSessionCookie = async (token: string, expiresAt: Date): Promise<void> => {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
};

export const clearSessionCookie = async (): Promise<void> => {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
};

export const readSessionCookie = async (): Promise<string | null> => {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
};
