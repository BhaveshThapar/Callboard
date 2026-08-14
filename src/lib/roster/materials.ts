/**
 * A4's materials half, pure.
 *
 * No `@/db` import, for `credentials.ts`'s reason: `src/db/index.ts` reads `DATABASE_URL` the moment
 * it loads, so anything sharing a file with it cannot be unit-tested. What a team filed is worth
 * testing without a database.
 */

/** What a captain may state about their own team. Every field is optional; blank clears. */
export type MaterialsInput = {
  musicUrl: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  rosterSizeRequested: number | null;
};

export type MaterialsResult =
  | { ok: true; value: MaterialsInput }
  | { ok: false; message: string };

/** Long enough for a Drive link with a query string, short enough that nobody is pasting a file. */
const MAX_URL = 2000;
const MAX_NAME = 200;
const MAX_PHONE = 40;

const blankToNull = (raw: string): string | null => {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * The seam a blob store would land in.
 *
 * Today a material *is* its URL, so this validates and hands it back. When there is somewhere to put
 * a file, this is where the upload happens and what it returns is still a URL — which is why
 * `music_url` is a plain `text` column and adding storage later is not a migration.
 *
 * `http(s)` only, and parsed rather than pattern-matched: `javascript:` and `data:` URLs are the
 * reason. This string is rendered as a link on the board's roster screen, so a captain who can store
 * an arbitrary scheme there is a captain who can hand the board a script to click.
 */
export const putMaterial = (raw: string): { ok: true; url: string | null } | { ok: false } => {
  const value = blankToNull(raw);
  if (value === null) return { ok: true, url: null };
  if (value.length > MAX_URL) return { ok: false };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false };
  return { ok: true, url: parsed.toString() };
};

/**
 * A stated roster size, which is a *claim* and never a bill.
 *
 * Blank is "I am not changing this" and 0 is a stated zero, the same distinction `rooms` draws — so
 * the empty string parses to null rather than to `Number("")`, which is 0 and would be a team
 * telling the board it has no dancers.
 */
const parseRequestedCount = (raw: string): { ok: true; value: number | null } | { ok: false } => {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false };

  const value = Number(trimmed);
  // A roster is people. Nobody fields a thousand dancers, and a paste accident should not become a
  // charge the board has to notice and undo.
  if (!Number.isSafeInteger(value) || value > 999) return { ok: false };
  return { ok: true, value };
};

export const parseMaterials = (fields: {
  musicUrl: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  rosterSizeRequested: string;
}): MaterialsResult => {
  const music = putMaterial(fields.musicUrl);
  if (!music.ok) {
    return { ok: false, message: "That music link needs to be a full http or https address." };
  }

  const name = blankToNull(fields.emergencyContactName);
  if (name && name.length > MAX_NAME) {
    return { ok: false, message: "That emergency contact name is too long." };
  }

  const phone = blankToNull(fields.emergencyContactPhone);
  if (phone && phone.length > MAX_PHONE) {
    return { ok: false, message: "That emergency contact number is too long." };
  }

  const requested = parseRequestedCount(fields.rosterSizeRequested);
  if (!requested.ok) {
    return { ok: false, message: "Dancers must be a whole number, or blank to leave it alone." };
  }

  return {
    ok: true,
    value: {
      musicUrl: music.url,
      emergencyContactName: name,
      emergencyContactPhone: phone,
      rosterSizeRequested: requested.value,
    },
  };
};
