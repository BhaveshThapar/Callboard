/**
 * The database side of the Gita, split from `src/lib/schedule/` exactly as `src/lib/comp/tab.ts` is
 * split from `src/lib/tabulation/` and `src/lib/money/charges.ts` from `src/lib/fees/`.
 *
 * Everything here reads the world; nothing here does arithmetic on a timeline. The engine takes
 * integer minutes and returns integer minutes, and **this is the one place a minute becomes a time of
 * day** — because that conversion needs a zone, a zone is a fact about a venue, and a pure module
 * that read one would bill the same show differently depending on where the server woke up.
 */
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { violatedConstraint } from "@/db/errors";
import type { ScheduleConfig } from "@/lib/schedule";
import { derive, showOrderFrom } from "@/lib/schedule";
import type { Delay, DrawCandidate, ScheduleResult, Segment } from "@/lib/schedule";
import { clockAt as clockAtRaw } from "./clock";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor, LiaisonActor, TeamActor } from "@/lib/auth/scope";
import { listDutiesForLiaison, listRosterForBoard, ownTeamForCaptain } from "@/lib/auth/scope";
import {
  comps,
  teams,
  PERFORMING_STATUSES,
  SCHEDULE_DELAY_SEQ_UNIQUE,
  scheduleDelays,
  type TeamStatus,
} from "@/db/schema";

export type DelayRow = {
  seq: number;
  minutes: number;
  fromPosition: number;
  reason: string;
  at: Date;
};

/**
 * A derived schedule, with the minutes already bound to wall-clock times.
 *
 * `config` comes back too, because a screen has to be able to say *this comp has not written its run
 * of show down* rather than render an empty timeline, and those are different facts.
 */
export type CompSchedule = {
  config: ScheduleConfig | null;
  result: ScheduleResult | null;
  delays: DelayRow[];
  /** Team id → name, so a timeline can be read by somebody who does not think in uuids. */
  names: Record<string, string>;
};

const listDelays = async (compId: string): Promise<DelayRow[]> => {
  const rows = await db
    .select({
      seq: scheduleDelays.seq,
      minutes: scheduleDelays.minutes,
      fromPosition: scheduleDelays.fromPosition,
      reason: scheduleDelays.reason,
      at: scheduleDelays.createdAt,
    })
    .from(scheduleDelays)
    .where(eq(scheduleDelays.compId, compId))
    .orderBy(asc(scheduleDelays.seq));
  return rows;
};

/**
 * The whole run of show for this comp, right now.
 *
 * Derived rather than stored, which is the decision `schedule_delays` records: the schedule is a
 * function of the draw, the buffers and the delay chain, and all three are already in this database.
 * A stored copy would be a second answer to a question that has one, and the disagreement between
 * them is the shape `db:doctor` exists to report.
 *
 * Reads the roster through `listRosterForBoard`, so it inherits that window's scope rather than
 * asking a new question about which teams count.
 */
export const scheduleForBoard = async (actor: BoardActor): Promise<CompSchedule> => {
  const [row] = await db
    .select({ schedule: comps.schedule })
    .from(comps)
    .where(eq(comps.id, actor.compId));

  const roster = await listRosterForBoard(actor);
  const names = Object.fromEntries(roster.map((team) => [team.id, team.name]));
  const delays = await listDelays(actor.compId);
  const config = row?.schedule ?? null;

  if (!config) return { config: null, result: null, delays, names };

  const candidates: DrawCandidate[] = roster
    .filter((team) => (PERFORMING_STATUSES as readonly TeamStatus[]).includes(team.status))
    .map((team) => ({ teamId: team.id, position: team.performanceOrder, bidCode: team.bidCode }));

  const asDelays: Delay[] = delays.map((delay) => ({
    seq: delay.seq,
    minutes: delay.minutes,
    fromPosition: delay.fromPosition,
    reason: delay.reason,
  }));

  return {
    config,
    result: derive({ showOrder: showOrderFrom(candidates), delays: asDelays }, config),
    delays,
    names,
  };
};

/** What a person reads, bound to this comp's anchor and zone. `./clock.ts` holds the arithmetic. */
export const clockAt = (config: ScheduleConfig, minute: number): string =>
  clockAtRaw(config.anchor, config.timezone, minute);

export type DelayResult = { ok: true; seq: number } | { ok: false; message: string };

/**
 * Records that the show is running late, or has caught up.
 *
 * `seq` is a read-then-insert on a driver with no transactions, so two board members typing a delay
 * in the same second read the same maximum. That is `nextBidCode`'s situation exactly, and it gets
 * `nextBidCode`'s remedy: the database refuses the second through `schedule_delays_comp_seq_unique`,
 * and the loser **retries** rather than being shown a failure. Comp day is precisely when two people
 * are working the same screen, and the one who lost the race did nothing wrong.
 *
 * Not a `withTransaction` caller. One INSERT is one act, and *the show is now twenty minutes behind*
 * implies nothing else that has to land with it — the schedule is derived on read, so there is no
 * second row to keep in step.
 */
export const addDelay = async (
  actor: BoardActor,
  input: { minutes: number; fromPosition: number; reason: string },
): Promise<DelayResult> => {
  if (!Number.isInteger(input.minutes) || input.minutes === 0) {
    return { ok: false, message: "Say how many minutes, up or down. Zero is not a delay." };
  }
  if (!Number.isInteger(input.fromPosition) || input.fromPosition < 1) {
    return { ok: false, message: "Say which act it starts from." };
  }
  const reason = input.reason.trim();
  if (reason === "") {
    return { ok: false, message: "Say what happened. A delay with no reason explains nothing later." };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const [head] = await db
      .select({ seq: sql<number>`coalesce(max(${scheduleDelays.seq}), 0)` })
      .from(scheduleDelays)
      .where(eq(scheduleDelays.compId, actor.compId));

    const seq = (head?.seq ?? 0) + 1;

    try {
      await db.insert(scheduleDelays).values({
        compId: actor.compId,
        seq,
        minutes: input.minutes,
        fromPosition: input.fromPosition,
        reason,
        createdByPersonId: actor.personId,
      });
    } catch (error) {
      if (violatedConstraint(error) === SCHEDULE_DELAY_SEQ_UNIQUE) continue;
      throw error;
    }

    await recordAudit({
      compId: actor.compId,
      actorKind: "board",
      actorPersonId: actor.personId,
      action: "schedule.delay",
      entity: "comp",
      entityId: actor.compId,
      before: null,
      after: { seq, ...input, reason },
    });

    return { ok: true, seq };
  }

  return { ok: false, message: "Somebody else is entering a delay right now. Try again." };
};

/** Whether a delay can be entered at all: `comps.status` says the show is running. */
export const scheduleIsLive = async (compId: string): Promise<boolean> => {
  const [row] = await db.select({ status: comps.status }).from(comps).where(eq(comps.id, compId));
  return row?.status === "live";
};

/**
 * One person's timeline — G4, and the ~30-column hand-compiled SATURDAY sheet it replaces.
 *
 * **Not a sixth window, and this is the argument.** Scope comes from `listDutiesForLiaison`, the
 * fifth window, which is already keyed on `actor.personId` off a `memberships` row — so there is no
 * read here that could return somebody else's duty, and no id arrives from a form. What this adds is
 * *times*, which is the half of "what am I supposed to be doing, and when" the fifth window was
 * argued into existence for and could not previously answer.
 *
 * The projection **is** the scope, `publicComp`'s rule: a liaison gets the segments of the teams they
 * are walking plus the comp-wide fixtures everybody shares, and no other team's row appears at all.
 * The derivation reads the whole draw internally because it has to — position 6's time depends on
 * positions 1 through 5 — and then returns none of it.
 */
export type PersonTimeline = {
  config: ScheduleConfig | null;
  /** Their own segments, in time order. Comp-wide fixtures are included; other teams are not. */
  segments: (Segment & { teamName: string | null; roomLabel: string | null })[];
  totalDelayMinutes: number;
};

const timelineFrom = (
  schedule: CompSchedule,
  teamIds: ReadonlySet<string>,
): PersonTimeline => ({
  config: schedule.config,
  totalDelayMinutes: schedule.result?.totalDelayMinutes ?? 0,
  segments: (schedule.result?.segments ?? [])
    .filter((segment) => segment.teamId === null || teamIds.has(segment.teamId))
    .map((segment) => ({
      ...segment,
      teamName: segment.teamId ? (schedule.names[segment.teamId] ?? null) : null,
      roomLabel:
        schedule.config?.rooms.find((room) => room.id === segment.room)?.label ?? segment.room,
    })),
});

/**
 * The comp's schedule, without an `Actor` — an internal helper, deliberately not exported.
 *
 * `scheduleForBoard` reads the roster through `listRosterForBoard` because a board is entitled to
 * every row of it. The per-person reads below cannot do that, so this one reads `teams` directly and
 * every caller filters it before returning. A function in this file taking no `Actor` is exactly the
 * shape somebody should flag on review, which is why it is said here and why nothing exports it.
 */
const compSchedule = async (compId: string): Promise<CompSchedule> => {
  const [row] = await db.select({ schedule: comps.schedule }).from(comps).where(eq(comps.id, compId));
  const roster = await db
    .select({
      id: teams.id,
      name: teams.name,
      bidCode: teams.bidCode,
      status: teams.status,
      performanceOrder: teams.performanceOrder,
    })
    .from(teams)
    .where(eq(teams.compId, compId));

  const names = Object.fromEntries(roster.map((team) => [team.id, team.name]));
  const delays = await listDelays(compId);
  const config = row?.schedule ?? null;
  if (!config) return { config: null, result: null, delays, names };

  const candidates: DrawCandidate[] = roster
    .filter((team) => (PERFORMING_STATUSES as readonly TeamStatus[]).includes(team.status))
    .map((team) => ({ teamId: team.id, position: team.performanceOrder, bidCode: team.bidCode }));

  return {
    config,
    result: derive(
      {
        showOrder: showOrderFrom(candidates),
        delays: delays.map(({ seq, minutes, fromPosition, reason }) => ({
          seq,
          minutes,
          fromPosition,
          reason,
        })),
      },
      config,
    ),
    delays,
    names,
  };
};

/** What a liaison is doing, and when. Their duties' teams, plus what everybody shares. */
export const timelineForLiaison = async (actor: LiaisonActor): Promise<PersonTimeline> => {
  const duties = await listDutiesForLiaison(actor);
  const teamIds = new Set(duties.flatMap((duty) => (duty.teamId ? [duty.teamId] : [])));
  return timelineFrom(await compSchedule(actor.compId), teamIds);
};

/** What a captain's own team is doing, and when. Their team only — `ownTeamForCaptain`'s guarantee. */
export const timelineForCaptain = async (actor: TeamActor): Promise<PersonTimeline> => {
  const team = await ownTeamForCaptain(actor);
  return timelineFrom(await compSchedule(actor.compId), new Set(team ? [team.id] : []));
};

/**
 * ADJ·4 — food timing, surfaced on its own.
 *
 * PRD §7.2 specifies it in one line: *"the hospitality slice that already lives inside the Gita."*
 * So it is a filter rather than a feature, and it is the reader `DUTY_CATEGORIES.hospitality` was
 * created for and nothing had read until now.
 */
export const foodSegments = (schedule: CompSchedule): Segment[] =>
  (schedule.result?.segments ?? []).filter((segment) => segment.kind === "food");
