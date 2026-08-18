/**
 * Where a minute becomes a time of day.
 *
 * Split from `./schedule.ts` for `src/lib/money/refusals.ts`' reason: that file imports `@/db`, which
 * reads `DATABASE_URL` the moment it loads, so nothing inside it can be unit-tested. This is the part
 * that most needs testing and least needs a database.
 *
 * It is deliberately **not** in `src/lib/schedule/`, which is fenced against `new Date()`. That fence
 * is the reason this file exists rather than an obstacle to it: the engine works in integer minutes
 * from an anchor precisely so that binding those minutes to a wall clock is one small, visible,
 * separately-tested step instead of an assumption spread through the derivation.
 */

/**
 * How far `timeZone` is from UTC at a given instant, in milliseconds.
 *
 * Computed by formatting the instant *in* the zone and reading the fields back, because that is the
 * only thing in the platform that knows about daylight saving. Positive east of UTC.
 */
export const zoneOffsetMs = (at: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
};

/**
 * The instant that is `minute` minutes after a comp's anchor.
 *
 * `anchor` is a local wall-clock string (`YYYY-MM-DDTHH:MM`) and `timeZone` is IANA, so this is
 * **not** `new Date(anchor)`. That parses in the *server's* zone, and Vercel's servers run in UTC —
 * which would put a noon call time at 8am for a comp in Maryland, silently, in production only.
 *
 * The offset is resolved twice on purpose. Reading it at the naive instant can land on the wrong side
 * of a daylight-saving boundary, and the second read — at the corrected instant — is what fixes it.
 * A show that actually crosses the boundary mid-run is a fact a board should state rather than
 * something to infer, but the anchor itself must land correctly either way.
 */
export const instantAt = (anchor: string, timeZone: string, minute: number): Date => {
  const naive = new Date(`${anchor}Z`);
  const first = new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
  const settled = new Date(naive.getTime() - zoneOffsetMs(first, timeZone));
  return new Date(settled.getTime() + minute * 60_000);
};

/** What a person reads — `Sat 3:40 PM` — in the comp's own zone rather than the server's. */
export const clockAt = (anchor: string, timeZone: string, minute: number): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(instantAt(anchor, timeZone, minute));
