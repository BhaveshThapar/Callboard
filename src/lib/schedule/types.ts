/**
 * The schedule engine's vocabulary. It lives here rather than in `src/db/schema/` for the reason
 * `TabulationInput` and `FeeSchedule` do: the pure module owns the definition and the schema imports
 * it, so the dependency points db → lib and the pure directory can stay fenced off from the database.
 *
 * Everything here is **integer minutes from an anchor**, never a `Date`. Two reasons, and the second
 * is the one that matters. `new Date()` is banned inside this fence, so a clock read cannot happen by
 * accident. And a run-of-show is arithmetic on durations — a show that starts at 9am and ends at 1am
 * crosses a date boundary, a comp is in one venue in one timezone, and the moment a derivation binds
 * to a wall clock it acquires a timezone bug nobody sees until March. The anchor and the zone are
 * bound once, at the impure boundary, where they can be looked at.
 */

/**
 * One definition: the type, `schedule_segments_kind_check` if a table ever needs one, and everything
 * the engine emits derive from it. Taken from DATA_MODEL.md's design, unchanged.
 *
 * The split that matters is not alphabetical. `walk`, `lobby`, `stretch`, `props`, `tech_in` and
 * `tech_out` are **per team** — they hang off one team's slot in the running order. `food`,
 * `judge_cutoff` and `transport` are **per comp**: they happen once and everybody's timeline reads
 * the same row. DATA_MODEL lists `team_id` unconditionally and that is the one thing in its design
 * that cannot be right, because a food service does not belong to a team.
 */
export const TEAM_SEGMENT_KINDS = ["walk", "lobby", "stretch", "props", "tech_in", "tech_out"] as const;

export const COMP_SEGMENT_KINDS = ["food", "judge_cutoff", "transport"] as const;

export const SEGMENT_KINDS = [...TEAM_SEGMENT_KINDS, ...COMP_SEGMENT_KINDS] as const;

export type TeamSegmentKind = (typeof TEAM_SEGMENT_KINDS)[number];
export type CompSegmentKind = (typeof COMP_SEGMENT_KINDS)[number];
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

/**
 * A room is a **config key**, not a table, for `duty_id`'s reason: the config is both the vocabulary
 * and the label it is read under, so there is one definition of what a comp called its stretch space
 * and it survives to be read a year later.
 *
 * INTAKE.md asked for this before the engine was written and said why: "almost every timing in a
 * Gita is really a statement about a room being free." The engine does not yet schedule *around* room
 * contention — it records which room a segment claims, so that a later rule can.
 */
export type RoomConfig = {
  id: string;
  label: string;
};

/**
 * What one per-team segment is, as a board states it.
 *
 * `endsBeforePerformance` is the chaining rule, and it is expressed as a distance from the team's own
 * slot rather than from the previous segment. That is deliberate: a spreadsheet chains each cell off
 * the one above it, which is why inserting a segment in the middle re-times everything below it by
 * hand. Anchoring every segment to the performance means a delay moves the slot and every segment
 * follows, which is G3 in one line.
 *
 * A negative value puts the segment *after* the performance — that is what `tech_out` is.
 */
export type TeamBufferRule = {
  kind: TeamSegmentKind;
  /**
   * `null` means *not yet known*. It does not mean zero — `BillableTeam.rosterSize`'s rule, applied
   * to time. Zero means the comp does not run this segment at all and produces no row; null means it
   * does and nobody has said how long, which produces a stated gap.
   */
  durationMinutes: number | null;
  /** Minutes before the team's performance start that this segment ends. Negative means after. */
  endsBeforePerformance: number | null;
  /** Key into `RoomConfig[]`. Null when the comp did not say. */
  room: string | null;
};

/** A comp-wide fixture: food arriving, the judges' cutoff, a van leaving. */
export type CompSegmentRule = {
  kind: CompSegmentKind;
  /** Distinguishes two of the same kind — "dinner" and "lunch" are both `food`. */
  id: string;
  label: string;
  /** Minutes from the comp anchor. */
  startsAtMinute: number;
  /** `null` means *not yet known*, exactly as on a team buffer. Zero means the comp does not run it. */
  durationMinutes: number | null;
  room: string | null;
  /**
   * Whether this fixture rides the delay. Food that was ordered for 6pm does not move because the
   * show slipped; a judges' cutoff does, because it is defined relative to the last performance.
   * Getting this wrong is how a system tells forty people dinner moved when the caterer did not.
   */
  movesWithShow: boolean;
};

/**
 * Engineered slack, and the reason G6 exists.
 *
 * PRD §9 G6 asks to "surface engineered slack (filler acts, exhibition padding, the 20-vs-30-minute
 * judge buffer) and flag when compound delays exhaust it." So slack is a **declared pool** with a
 * budget, not a gap the engine discovers: the 20-told/30-held judge buffer is ten minutes that exist
 * on purpose, and INTAKE.md is blunt about what happens without this — "a system that does not know
 * about it will spend it without telling you."
 */
export type SlackPool = {
  id: string;
  label: string;
  minutes: number;
};

/**
 * The buffers, as a comp states them. This is the shape INTAKE.md Part 3 promised a board: "the
 * buffers become configuration — the same shape your fee schedule and your rubric already take, so
 * the first real one to arrive is data rather than a migration."
 *
 * No founding partner has sent a Gita. Every number below is therefore a board's to state and none
 * has a default, which is the same call the fee schedule made and the reason a missing buffer
 * produces a stated gap rather than a zero.
 */
export type BufferConfig = {
  /**
   * Minutes from the comp anchor to the **first** performance. Load-bearing rather than cosmetic:
   * without it, position 1's walk and lobby land at negative minutes, because they happen before the
   * show starts. The anchor is doors-open or call time, and the first act is some way after it.
   */
  firstSlotAtMinute: number;
  /** How long one team's slot is, before any per-team buffer applies. `null` means nobody has said. */
  slotMinutes: number | null;
  /** Dead time between one team leaving the stage and the next starting. */
  changeoverMinutes: number;
  rooms: readonly RoomConfig[];
  teamBuffers: readonly TeamBufferRule[];
  compSegments: readonly CompSegmentRule[];
  slack: readonly SlackPool[];
};

/** One team's place in the Friday-night draw. */
export type ShowOrderEntry = {
  teamId: string;
  /** 1-based. `teams.performance_order` is the single definition of this; there is no second table. */
  position: number;
};

/**
 * A delay, as somebody typed it on comp day. PRD §9 G3 says "per segment", so a delay names what
 * slipped rather than shifting the whole day by a constant.
 *
 * `fromPosition` is where the delay starts biting: a team that has already danced is not re-timed by
 * the show running late afterwards. That is the difference between a schedule and a apology.
 */
export type Delay = {
  seq: number;
  minutes: number;
  /** The running-order position from which this applies. */
  fromPosition: number;
  reason: string;
};

export type ScheduleInput = {
  /** Minutes are counted from here. The wall clock is bound outside this module. */
  showOrder: readonly ShowOrderEntry[];
  /** Append-only, ordered by `seq`. The engine folds them; it never mutates them. */
  delays: readonly Delay[];
};

/** A derived segment. No id and no timestamp — those belong to the row, not here. */
export type Segment = {
  kind: SegmentKind;
  /** Null for a comp-wide fixture. */
  teamId: string | null;
  /** For a comp fixture, its config id. For a team segment, the kind. */
  ref: string;
  startsAtMinute: number;
  endsAtMinute: number;
  room: string | null;
  /**
   * Which rule produced this timing. DATA_MODEL called it `derived_from` and it is what lets a live
   * delay re-derive the cascade instead of a human doing it by mouth — and what lets a board ask
   * *why is my team walking at 3:40* and get an answer.
   */
  derivedFrom: string;
};

/**
 * A segment the engine *would* have produced if something were stated. `BillingGap`'s rule, applied
 * to time: stated, never guessed.
 *
 * An unstated buffer produces one of these, **not** a zero-minute segment. A zero-minute walk is a
 * lie a liaison will believe, and they will believe it standing in the wrong corridor.
 */
export type ScheduleGap = {
  kind: SegmentKind;
  teamId: string | null;
  missing: "durationMinutes" | "endsBeforePerformance" | "slotMinutes" | "room";
};

/** What a declared slack pool has left after the delays are folded in. */
export type SlackState = {
  id: string;
  label: string;
  budgetedMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
};

export type ScheduleResult = {
  /** Total delay folded out of `delays`, for the operator who asked "how far behind are we". */
  totalDelayMinutes: number;
  segments: Segment[];
  /** Things the engine could not compute, stated rather than defaulted. */
  gaps: ScheduleGap[];
  slack: SlackState[];
  /**
   * Slack pools the delays have fully consumed — "the board's own stated breaking point" (PRD §9 G6).
   * Surfaced, never silently absorbed, for `unresolvedTies`' reason: the operator must be told that
   * something now has to give, because the engine cannot decide what.
   */
  exhausted: string[];
  /**
   * Delay that no declared slack can absorb. This is the number the board actually needs: `exhausted`
   * says which recoveries are gone, this says how many minutes are left over after all of them, and
   * a non-zero value means the show ends late unless somebody cuts something. The engine states it
   * and stops — choosing what to cut is a board's decision and `unresolvedTies` is the precedent.
   */
  unabsorbedMinutes: number;
};

/**
 * A comp's whole run of show, as a board states it: the buffers plus the two facts that bind them to
 * a wall clock.
 *
 * `BufferConfig` is deliberately not extended in the engine's direction — `derive` takes the buffers
 * and knows nothing about `anchor` or `timezone`, because the moment a pure derivation touches a
 * wall clock it acquires a timezone bug nobody sees until March. Binding happens once, outside the
 * fence, where somebody can look at it.
 */
export type ScheduleConfig = BufferConfig & {
  /**
   * When minute zero is, as a local wall-clock string (`YYYY-MM-DDTHH:MM`). Not a `Date` and not a
   * UTC instant: a board says "doors at noon", and noon is a fact about the venue.
   */
  anchor: string;
  /**
   * The IANA zone the anchor is read in — `America/New_York`, not an offset. `comps.comp_date` is a
   * bare `date` with no time and no zone, which is why this exists: a show that starts at 9am and
   * runs past midnight cannot be expressed without one, and a server rendering it in UTC would put a
   * 9am call time at 2pm.
   */
  timezone: string;
};
