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

/**
 * Where a board **link** lives once it has been opened ([ADR-0022]).
 *
 * This is ADR-0003's own named hardening, arriving as a side effect of centralizing the product
 * rather than as a project: *"exchange the URL token for an HttpOnly cookie on first load and strip
 * it from the address bar, so the credential stops living in history."* A board link is still a
 * bearer credential and still revocable in one statement; what changes is that it stops being
 * re-transmitted on every navigation and stops appearing in a screenshot of the address bar.
 *
 * **It holds a raw token, not an identity**, so it grants exactly what the link granted — one
 * comp — and `resolveBoardAccess` proves that comp matches the one being asked for. It is not a
 * session: there is no row behind it, nothing to revoke but the assignment it names, and no account.
 *
 * One cookie, overwritten. Somebody holding links for two comps re-opens the second link, which is
 * what they do today anyway; the alternative is a cookie per comp accumulating in a browser forever
 * for a case nobody has yet.
 *
 * `maxAge` rather than `expires`, and short: a link's authority is the row, so this only decides how
 * long a browser can skip re-reading the URL. Twelve hours covers a comp day and expires before the
 * laptop is opened at the next one.
 *
 * [ADR-0022]: ../../../docs/decisions/0022-a-link-is-exchanged-for-a-cookie.md
 */
export const BOARD_LINK_COOKIE = "callboard_board_link";

/**
 * Exported because the door sets this on a `NextResponse` rather than through `cookies()`.
 *
 * A route handler that both sets a cookie and redirects is clearer setting it on the response it is
 * returning — one object, one act — and there must not be two descriptions of what this cookie is.
 */
export const BOARD_LINK_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 12,
} as const;

export const setBoardLinkCookie = async (token: string): Promise<void> => {
  const jar = await cookies();
  jar.set(BOARD_LINK_COOKIE, token, BOARD_LINK_COOKIE_OPTIONS);
};

export const readBoardLinkCookie = async (): Promise<string | null> => {
  const jar = await cookies();
  return jar.get(BOARD_LINK_COOKIE)?.value ?? null;
};

export const clearBoardLinkCookie = async (): Promise<void> => {
  const jar = await cookies();
  jar.delete(BOARD_LINK_COOKIE);
};
