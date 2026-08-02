/**
 * The pure half of P1: everything about a credential that can be decided without a database.
 *
 * Split from `./accounts` for `src/lib/money/refusals.ts`' reason — that module imports `@/db`,
 * which reads `DATABASE_URL` the moment it loads, so anything living inside it cannot be unit-tested
 * at all. The rules most worth testing here are the ones least in need of a database: what makes a
 * password acceptable, what makes an email the same email, and whether a session has expired.
 *
 * No clock is read. `now` is an argument, for `src/lib/fees/schedule.ts`' reason: a module that reads
 * the clock decides differently on Tuesday, and "is this session still valid" is exactly the kind of
 * question that must be answerable about a moment other than this one.
 */

/**
 * Two people typing the same address must get the same account.
 *
 * Trim and lowercase only. **Deliberately not** dot-stripping or `+tag` removal, which Gmail
 * happens to ignore and most other hosts do not: normalizing beyond the standard would silently
 * merge two addresses that a university mail server considers different people, and merging two
 * humans into one login is a worse failure than making somebody type their address carefully.
 *
 * `users_email_lower_check` enforces the lowercase half in the database, so a writer that skips this
 * function is refused rather than quietly creating a second account.
 */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

/**
 * Not full RFC 5322 — a deliberate choice, and the reason is what happens on each side of a wrong
 * answer. A false reject stops somebody signing up and they tell you. A false accept puts an
 * unreachable address on an account that dues reminders are sent to, and nobody finds out until a
 * team is chased for money it was never asked for.
 *
 * So: one `@`, something either side, a dot in the domain, no whitespace. Everything else is the
 * verification email's job, which is the only real test of an address anyway.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (raw: string): boolean => EMAIL.test(normalizeEmail(raw));

/** Long enough to survive a guess, short enough that a password manager's output fits. */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

export type PasswordRefusal = { ok: false; message: string };
export type PasswordAccepted = { ok: true };

/**
 * **Length, and nothing else.** No character-class rules, no "must contain a symbol".
 *
 * Composition rules push people toward `Password1!` and away from a passphrase, which is the
 * opposite of what they are for; NIST dropped them for that reason. The upper bound exists only
 * because argon2 will happily hash a megabyte and a request should not.
 *
 * The refusal says the rule rather than restating that the input was wrong, because a board member
 * resetting a password at 11pm is the person reading it.
 */
export const checkPassword = (password: string): PasswordAccepted | PasswordRefusal => {
  if (password.length < PASSWORD_MIN) {
    return {
      ok: false,
      message: `A password needs at least ${PASSWORD_MIN} characters. A short sentence is a good one.`,
    };
  }
  if (password.length > PASSWORD_MAX) {
    return { ok: false, message: `A password can be at most ${PASSWORD_MAX} characters.` };
  }
  return { ok: true };
};

/** Thirty days. A board member who logs in during registration should still be in at the comp. */
export const SESSION_DAYS = 30;

/** An invitation is short-lived on purpose: it is authority sitting in somebody's inbox. */
export const INVITE_DAYS = 14;

/** A reset is shorter still, because it is authority sitting in an inbox somebody may not own. */
export const RESET_HOURS = 2;

export const expiresAfter = (now: Date, ms: number): Date => new Date(now.getTime() + ms);

export const sessionExpiry = (now: Date): Date => expiresAfter(now, SESSION_DAYS * 86_400_000);
export const inviteExpiry = (now: Date): Date => expiresAfter(now, INVITE_DAYS * 86_400_000);
export const resetExpiry = (now: Date): Date => expiresAfter(now, RESET_HOURS * 3_600_000);

/**
 * Whether a credential row is still good, given the three ways it can stop being good.
 *
 * One function for sessions and invitations both, because they fail identically and a second copy
 * would be a second definition of "still valid" — the thing that goes wrong is one of them growing
 * a case the other did not.
 *
 * **Expiry is `<=`, not `<`.** A token that expires at exactly `now` is expired; the alternative
 * gives a one-tick window that only shows up under a clock that happens to land on it.
 */
export type Expirable = {
  expiresAt: Date;
  revokedAt?: Date | null;
  acceptedAt?: Date | null;
};

export const isLive = (row: Expirable, now: Date): boolean =>
  row.revokedAt == null && row.acceptedAt == null && row.expiresAt.getTime() > now.getTime();
