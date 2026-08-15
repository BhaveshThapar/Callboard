/**
 * The OAuth `state` cookie: a CSRF token and the two slugs to come back to.
 *
 * `sameSite: "lax"` rather than `"strict"`, and that is forced: this cookie has to survive a
 * top-level redirect back from `accounts.google.com`, and a strict cookie is not sent on a
 * cross-site navigation. Lax still withholds it from cross-site subresource requests, which is the
 * case that matters.
 *
 * Ten minutes, because it covers one consent screen and nothing else. A long-lived CSRF token is a
 * CSRF token an attacker has time to work with.
 */
export const DRIVE_STATE_COOKIE = "callboard_drive_state";

export const DRIVE_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 10,
} as const;

export type DriveStateCookie = { state: string; org: string; comp: string };

/** Never throws on junk: a malformed cookie is somebody tampering, and it means the same as absent. */
export const parseDriveState = (raw: string | undefined): DriveStateCookie | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DriveStateCookie>;
    if (!parsed.state || !parsed.org || !parsed.comp) return null;
    return { state: parsed.state, org: parsed.org, comp: parsed.comp };
  } catch {
    return null;
  }
};
