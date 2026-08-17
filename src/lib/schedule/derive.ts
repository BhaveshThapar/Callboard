/**
 * G2 and G3 — the run of show, as a function of the draw, the buffers and the delays.
 *
 * Pure, and fenced by ESLint rather than by this comment (`pureZone` in eslint.config.mjs, the same
 * helper that fences `src/lib/tabulation/` and `src/lib/fees/`). `src/lib/coord/duties.ts` reserved
 * the fence for this directory before it existed, and named the property that earns it: a timeline
 * replayed from a chain is a claim somebody acted on, the way a locked placement and a bill are.
 *
 * The database side is `src/lib/schedule-io/`, split from this the way `src/lib/comp/tab.ts` is split
 * from `src/lib/tabulation/` and `src/lib/money/charges.ts` from `src/lib/fees/`.
 *
 * The spreadsheet this replaces is a compiler: one input, the Friday-night draw, and chained `TIME()`
 * formulas down from it. What it cannot do is the one thing comp day needs — take a delay. So the
 * chaining here is deliberately *not* cell-above-cell: every segment is anchored to its own team's
 * slot, so a delay moves slots and every segment follows. That is G3, and it is why the derivation is
 * a fold over an append-only list rather than an edit to a stored timeline.
 */
import type {
  BufferConfig,
  Delay,
  ScheduleGap,
  ScheduleInput,
  ScheduleResult,
  Segment,
  SlackState,
} from "./types";

/**
 * How far behind the show is by the time it reaches a given slot.
 *
 * A delay names the position it starts biting from, so a team that has already danced is not
 * re-timed by the show running late afterwards. Summed rather than taking the last, because delays
 * compound — which is the whole of G6: two twenty-minute slips are forty minutes, and the board's
 * stated breaking point is the moment the compound total exceeds the slack somebody engineered in.
 */
const delayAt = (delays: readonly Delay[], position: number): number =>
  delays.reduce((sum, delay) => (position >= delay.fromPosition ? sum + delay.minutes : sum), 0);

/**
 * Where a team's performance starts, in minutes from the comp anchor.
 *
 * Ordered by `position`, not by array order: `showOrder` arrives from a query and Postgres promises
 * nothing about row order. `src/lib/tabulation/aggregate.ts` sorts for the same reason, and there it
 * was float associativity; here it is that position 3 must start after position 2 regardless of how
 * the rows came back.
 */
const slotStart = (
  position: number,
  firstSlotAtMinute: number,
  slotMinutes: number,
  changeoverMinutes: number,
): number => firstSlotAtMinute + (position - 1) * (slotMinutes + changeoverMinutes);

/**
 * The whole derivation: what every segment's start and end are, what could not be computed, and what
 * the delays have spent out of the slack that was engineered on purpose.
 *
 * A zero-valued buffer produces **no segment at all**, exactly as a zero-valued fee component
 * produces no charge line: a comp with `durationMinutes: 0` for props does not schedule a
 * zero-minute props segment, it does not schedule props. A `null` is the different thing — *stated
 * that it happens, not stated how long* — and that produces a `ScheduleGap`, never a zero. A
 * zero-minute walk is a lie a liaison will believe, and they will believe it standing in the wrong
 * corridor at the wrong end of the building.
 */
export const derive = (input: ScheduleInput, buffers: BufferConfig): ScheduleResult => {
  const segments: Segment[] = [];
  const gaps: ScheduleGap[] = [];

  const order = [...input.showOrder].sort((a, b) => a.position - b.position);
  const delays = [...input.delays].sort((a, b) => a.seq - b.seq);
  const lastPosition = order.length === 0 ? 0 : (order[order.length - 1]?.position ?? 0);
  const totalDelayMinutes = delayAt(delays, lastPosition);

  if (buffers.slotMinutes === null) {
    // Without a slot length nothing downstream has a start, so this is reported once against the
    // comp rather than once per team: a board reading forty identical gap rows learns less than it
    // does from one, and the fix is the same single number either way.
    gaps.push({ kind: "walk", teamId: null, missing: "slotMinutes" });
    return { totalDelayMinutes, segments, gaps, ...absorb(buffers, totalDelayMinutes) };
  }

  const slotMinutes = buffers.slotMinutes;
  const changeover = buffers.changeoverMinutes ?? 0;

  // A buffer that does not say how long it is, or what it hangs off, is a fact about the **config**
  // and not about any team — so it is reported once, with a null `teamId`, rather than once per team.
  // The distinction is not tidiness: `BillingGap` is per team because `rooms` and `rosterSize` are
  // per team and each needs its own answer, whereas one board typing one number fixes every row here.
  // Forty identical gaps is a screen a board scrolls past, which is how a stated gap becomes as
  // useless as the zero it was written to avoid.
  const usable = buffers.teamBuffers.filter((rule) => {
    if (rule.durationMinutes === null) {
      gaps.push({ kind: rule.kind, teamId: null, missing: "durationMinutes" });
      return false;
    }
    if (rule.endsBeforePerformance === null) {
      gaps.push({ kind: rule.kind, teamId: null, missing: "endsBeforePerformance" });
      return false;
    }
    return rule.durationMinutes > 0;
  });

  for (const entry of order) {
    const start =
      slotStart(entry.position, buffers.firstSlotAtMinute, slotMinutes, changeover) +
      delayAt(delays, entry.position);

    for (const rule of usable) {
      // Narrowed by the filter above, which TypeScript cannot see through the predicate.
      const duration = rule.durationMinutes ?? 0;
      const endsAt = start - (rule.endsBeforePerformance ?? 0);
      segments.push({
        kind: rule.kind,
        teamId: entry.teamId,
        ref: rule.kind,
        startsAtMinute: endsAt - duration,
        endsAtMinute: endsAt,
        room: rule.room,
        derivedFrom: `teamBuffers.${rule.kind}`,
      });
    }
  }

  for (const fixture of buffers.compSegments) {
    if (fixture.durationMinutes === null) {
      gaps.push({ kind: fixture.kind, teamId: null, missing: "durationMinutes" });
      continue;
    }
    if (fixture.durationMinutes === 0) continue;

    // A fixture rides the delay only if it was defined relative to the show. Food ordered for 6pm
    // does not move because the show slipped, and telling forty people that it did is worse than
    // saying nothing — the caterer did not get the message.
    const shift = fixture.movesWithShow ? totalDelayMinutes : 0;
    segments.push({
      kind: fixture.kind,
      teamId: null,
      ref: fixture.id,
      startsAtMinute: fixture.startsAtMinute + shift,
      endsAtMinute: fixture.startsAtMinute + shift + fixture.durationMinutes,
      room: fixture.room,
      derivedFrom: `compSegments.${fixture.id}`,
    });
  }

  segments.sort(
    (a, b) => a.startsAtMinute - b.startsAtMinute || a.ref.localeCompare(b.ref) || (a.teamId ?? "").localeCompare(b.teamId ?? ""),
  );

  return { totalDelayMinutes, segments, gaps, ...absorb(buffers, totalDelayMinutes) };
};

/**
 * G6 — what the delay has spent, out of what was engineered on purpose.
 *
 * Slack is a **declared pool** rather than a gap the engine finds, because the slack that matters is
 * invisible in a timeline: the 20-minutes-told/30-minutes-held judge buffer looks like a 30-minute
 * cutoff, and the ten minutes of give only exist in somebody's head. INTAKE.md asked for it in those
 * words and said what happens otherwise — "a system that does not know about it will spend it
 * without telling you."
 */
const absorb = (
  buffers: BufferConfig,
  totalDelayMinutes: number,
): { slack: SlackState[]; exhausted: string[]; unabsorbedMinutes: number } => {
  // Pools are spent **in the order the board declared them**, not each against the full delay
  // independently. That distinction is the whole of G6: slack pools are separate recoveries that add
  // up — cut the filler act, shorten the held judge buffer — so a forty-minute slip eats the first
  // pool, then the next. Scoring each pool against the full delay would report three pools
  // simultaneously exhausted by a delay any one of them could have absorbed, which reads as a crisis
  // where there is none, and this is a screen somebody looks at while already behind.
  let remaining = Math.max(0, totalDelayMinutes);
  const slack: SlackState[] = [];
  const exhausted: string[] = [];

  for (const pool of buffers.slack) {
    const consumed = Math.min(pool.minutes, remaining);
    remaining -= consumed;
    slack.push({
      id: pool.id,
      label: pool.label,
      budgetedMinutes: pool.minutes,
      consumedMinutes: consumed,
      remainingMinutes: pool.minutes - consumed,
    });
    // `pool.minutes > 0` guards a declared-but-empty pool, which would otherwise report itself
    // exhausted by a delay of zero and put a comp on its breaking point before the doors opened.
    if (pool.minutes > 0 && consumed === pool.minutes) exhausted.push(pool.id);
  }

  return { slack, exhausted, unabsorbedMinutes: remaining };
};
