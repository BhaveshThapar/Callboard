import { COMP_STATUSES, CUSTOM_FIELD_TYPES, DUTY_CATEGORIES } from "@/db/schema/orgs";
import type { CompStatus, CustomField, DutyConfig, RegistrationConfig } from "@/db/schema/orgs";
import { TEAM_STATUSES } from "@/db/schema/teams";
import type { TeamStatus } from "@/db/schema/teams";
import { COMP_SEGMENT_KINDS, TEAM_SEGMENT_KINDS } from "@/lib/schedule/types";
import type { ScheduleConfig } from "@/lib/schedule/types";
import { NORMALIZATIONS } from "@/lib/tabulation/types";
import type { NormalizationMethod } from "@/lib/tabulation/types";

/**
 * A comp described as data, so a board's own rubric can be stood up without a setup UI.
 * This file never touches the database: it is a parser, and it unit-tests without DATABASE_URL.
 *
 * A config tiebreaker names a criterion by label, not by id, because ids do not exist until the
 * criteria are inserted. `seedFromConfig` resolves the label. That is the one place the config
 * shape and the runtime `Tiebreaker` shape legitimately differ.
 */
export type ConfigTiebreaker =
  | { kind: "criterion"; criterion: string }
  | { kind: "head_to_head" }
  | { kind: "highest_single_judge" };

export type CompConfig = {
  org: { name: string; slug: string };
  comp: {
    name: string;
    slug: string;
    compDate?: string;
    venue?: string;
    status: CompStatus;
  };
  rubric: {
    name: string;
    normalization: NormalizationMethod;
    tiebreakers: ConfigTiebreaker[];
    criteria: { label: string; maxPoints: number; weightBp: number; sortOrder: number }[];
  };
  teams: {
    name: string;
    school?: string;
    bidCode: string;
    division?: string;
    rosterSize?: number;
    performanceOrder?: number;
    /** Defaults to `competing`: a config written for a scoring demo describes a comp already run. */
    status?: TeamStatus;
    waitlistRank?: number;
    /** Hotel rooms. Omitted means *not yet known*, which bills nothing and states a gap. */
    rooms?: number;
    /**
     * The captain to reach about this team — the same thing the registration form collects, for a
     * team that never filled one in.
     *
     * Without it a seeded team has no `contact_person_id`, so A10 skips it as unreachable and the
     * dues-reminder beat cannot be rehearsed on the demo comp at all. `people` is org-scoped and
     * found rather than re-inserted, so the same captain across two comps is one person.
     */
    contact?: { name: string; email: string };
  }[];
  judges: { name: string; email?: string }[];
  board: { name: string; email?: string }[];
  /**
   * The public registration form, as data — the same way the rubric is (B1).
   *
   * Absent means registration is not open, which is not the same as an empty form: a comp with no
   * `registration` block serves a 404 at `/register`, rather than a form nobody will read.
   *
   * There is deliberately **no division field.** A comp is one division (ADR-0010), so asking an
   * applicant to choose one would be soliciting an answer nothing reads — which is the exact mistake
   * that ADR removed a column to fix.
   */
  registration?: RegistrationConfig;
  /**
   * The duties a board can assign (C1, PRD §7.3). Absent means this comp coordinates nobody, which
   * is the honest state of every comp until a board writes the list down.
   */
  duties?: DutyConfig[];
  schedule?: ScheduleConfig;
  /**
   * What the comp charges, in cents — the five numbers [INTAKE.md](../../docs/INTAKE.md) asks a
   * treasurer for, authored as data the same way the rubric is.
   *
   * Absent means the comp bills nothing, which is not the same as billing zero: no schedule means
   * no `charges` rows at all, and a screen that says so rather than one showing every team a $0
   * balance it might believe.
   */
  feeSchedule?: FeeScheduleConfig;
};

export type FeeScheduleConfig = {
  perDancerCents: number;
  perRoomCents: number;
  depositCents: number;
  lateFeeCents: number;
  /** ISO `YYYY-MM-DD`, or absent when the comp charges no late fee. */
  lateAfter?: string;
};

const TIEBREAKER_KINDS = ["criterion", "head_to_head", "highest_single_judge"] as const;

const fail = (path: string, expected: string): never => {
  throw new Error(`${path}: expected ${expected}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown, path: string): Record<string, unknown> =>
  isRecord(value) ? value : fail(path, "an object");

const array = (value: unknown, path: string): unknown[] =>
  Array.isArray(value) ? value : fail(path, "an array");

const str = (value: unknown, path: string): string =>
  typeof value === "string" && value.trim() !== "" ? value : fail(path, "a non-empty string");

const optStr = (value: unknown, path: string): string | undefined =>
  value === undefined || value === null ? undefined : str(value, path);

const int = (value: unknown, path: string): number =>
  typeof value === "number" && Number.isInteger(value) ? value : fail(path, "a whole number");

const optInt = (value: unknown, path: string): number | undefined =>
  value === undefined || value === null ? undefined : int(value, path);

/**
 * A captain, or nothing. The address is checked here rather than at send time for the reason every
 * other config field is: a board's own file is what is wrong, and the person holding it gets a
 * sentence naming the field instead of a bounced message three weeks later.
 */
const parseContact = (
  value: unknown,
  path: string,
): { name: string; email: string } | undefined => {
  if (value === undefined || value === null) return undefined;
  const c = record(value, path);
  const email = str(c.email, `${path}.email`).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(`${path}.email`, "an email address");
  return { name: str(c.name, `${path}.name`).trim(), email };
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], path: string): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fail(path, `one of ${allowed.join(", ")}`);

const tiebreaker = (value: unknown, path: string): ConfigTiebreaker => {
  const raw = record(value, path);
  const kind = oneOf(raw.kind, TIEBREAKER_KINDS, `${path}.kind`);
  if (kind === "criterion") {
    return { kind, criterion: str(raw.criterion, `${path}.criterion`) };
  }
  return { kind };
};

/**
 * A storage key, not a label. It names a column in `teams.custom_answers` forever, and — since C1 —
 * the `duty_id` an `assignments` row stores forever. Constraining it to lowercase snake_case keeps
 * it readable in the raw json a board may one day be handed, and keeps it distinguishable at a
 * glance from the camelCase names the built-in half of the form uses — which it never has to be
 * checked against, because the two live in separate namespaces (`CUSTOM_FIELD_PREFIX`) rather than
 * in one namespace policed by a list.
 *
 * **Shared by custom fields and duties rather than copied.** They are the same kind of thing under
 * the same rule — a key a row points at, which a board must not rename once rows exist — so a second
 * regex would be a second definition of that rule and would drift on the first edit.
 */
const FIELD_ID = /^[a-z][a-z0-9_]*$/;

/**
 * One board-authored question. Refused at the door, because this is the only door: the config is
 * both the form and the schema its answers are validated against, so a field that cannot be
 * rendered or cannot be checked must never reach a comp.
 *
 * `id` is constrained hardest because it is the key answers are stored under. It is also the one
 * thing a board must not edit after applications start arriving — renaming it orphans every answer
 * already filed — which the shape cannot enforce and `INTAKE.md` has to say out loud.
 */
const customField = (value: unknown, path: string, seen: Set<string>): CustomField => {
  const raw = record(value, path);

  const id = str(raw.id, `${path}.id`);
  if (!FIELD_ID.test(id)) {
    fail(`${path}.id`, "a lowercase key like `props_needed` — it is the key answers are stored under");
  }
  if (seen.has(id)) fail(`${path}.id`, `an id no other field uses (not "${id}" twice)`);
  seen.add(id);

  const type = oneOf(raw.type, CUSTOM_FIELD_TYPES, `${path}.type`);

  const options =
    type === "select"
      ? array(raw.options, `${path}.options`).map((o, i) => str(o, `${path}.options[${i}]`))
      : undefined;
  if (options && options.length < 2) {
    fail(`${path}.options`, "at least two choices — a choice of one is a statement, not a question");
  }

  const maxLength = optInt(raw.maxLength, `${path}.maxLength`);
  if (maxLength !== undefined && maxLength <= 0) fail(`${path}.maxLength`, "a value above zero");

  return {
    id,
    label: str(raw.label, `${path}.label`),
    type,
    required: raw.required === true,
    help: optStr(raw.help, `${path}.help`),
    options,
    maxLength,
  };
};

/**
 * A comp is one division: one rubric, one judge pool, one ranked list.
 *
 * Nothing downstream is division-aware, and nothing is meant to be — `listTeamsForJudge` scopes by
 * comp, `getRubric` returns the comp's single rubric, and `tabulate` returns one ranked list. So a
 * config carrying two divisions does not produce two competitions. It produces one wrong one: judges
 * scoring outside their division, every division ranked against the others, and per-division score
 * sheets collapsed into whichever rubric was inserted first. Divisions are separate comps.
 *
 * Refused here, at the only door, because a division that is stored and never read is
 * indistinguishable from a feature right up until it places a team (ADR-0010).
 */
const oneDivision = (rows: { division?: string }[]): void => {
  // Only *named* divisions count. A row with none is an unlabelled row, not a second division:
  // there is one comp and one ranked list either way, so it changes no result. Two names do.
  const named = new Set(rows.flatMap((r) => (r.division === undefined ? [] : [r.division])));
  if (named.size <= 1) return;

  throw new Error(
    `config declares ${named.size} divisions (${[...named].sort().join(", ")}). A comp scores one ` +
      `division — one rubric, one judge pool, one ranked list. Divisions are separate comps: ` +
      `split this into one config per division. See docs/INTAKE.md`,
  );
};

export const parseCompConfig = (raw: unknown): CompConfig => {
  const root = record(raw, "config");

  const org = record(root.org, "org");
  const comp = record(root.comp, "comp");
  const rubric = record(root.rubric, "rubric");

  const criteria = array(rubric.criteria, "rubric.criteria").map((entry, i) => {
    const c = record(entry, `rubric.criteria[${i}]`);
    const maxPoints = int(c.maxPoints, `rubric.criteria[${i}].maxPoints`);
    if (maxPoints <= 0) fail(`rubric.criteria[${i}].maxPoints`, "a value above zero");

    const weightBp = optInt(c.weightBp, `rubric.criteria[${i}].weightBp`) ?? 10_000;
    if (weightBp < 0) fail(`rubric.criteria[${i}].weightBp`, "a value of zero or more");

    return {
      label: str(c.label, `rubric.criteria[${i}].label`),
      maxPoints,
      weightBp,
      sortOrder: optInt(c.sortOrder, `rubric.criteria[${i}].sortOrder`) ?? i,
    };
  });
  if (criteria.length === 0) fail("rubric.criteria", "at least one criterion");

  const labels = new Set(criteria.map((c) => c.label));
  if (labels.size !== criteria.length) fail("rubric.criteria", "criterion labels to be unique");

  const tiebreakers = array(rubric.tiebreakers ?? [], "rubric.tiebreakers").map((entry, i) =>
    tiebreaker(entry, `rubric.tiebreakers[${i}]`),
  );
  for (const [i, t] of tiebreakers.entries()) {
    if (t.kind === "criterion" && !labels.has(t.criterion)) {
      fail(`rubric.tiebreakers[${i}].criterion`, `a criterion label that exists (${t.criterion})`);
    }
  }

  const teams = array(root.teams, "teams").map((entry, i) => {
    const t = record(entry, `teams[${i}]`);
    const status =
      t.status === undefined ? undefined : oneOf(t.status, TEAM_STATUSES, `teams[${i}].status`);

    if (t.waitlistRank !== undefined && status !== "waitlisted") {
      fail(`teams[${i}].waitlistRank`, "a team that is waitlisted — a rank on any other status ranks nothing");
    }

    return {
      name: str(t.name, `teams[${i}].name`),
      school: optStr(t.school, `teams[${i}].school`),
      bidCode: str(t.bidCode, `teams[${i}].bidCode`),
      division: optStr(t.division, `teams[${i}].division`),
      rosterSize: optInt(t.rosterSize, `teams[${i}].rosterSize`),
      performanceOrder: optInt(t.performanceOrder, `teams[${i}].performanceOrder`) ?? i + 1,
      status,
      waitlistRank: optInt(t.waitlistRank, `teams[${i}].waitlistRank`),
      rooms: optInt(t.rooms, `teams[${i}].rooms`),
      contact: parseContact(t.contact, `teams[${i}].contact`),
    };
  });
  if (teams.length === 0) fail("teams", "at least one team");

  const bidCodes = new Set(teams.map((t) => t.bidCode));
  if (bidCodes.size !== teams.length) fail("teams", "bid codes to be unique");

  // A judge's division is read only to enforce `oneDivision`, and never returned: judges are
  // assigned to the comp, and the comp is the division. A panel split across two divisions is one
  // of the two ways a config declares two competitions, so it has to be seen here to be refused.
  const judges = array(root.judges, "judges").map((entry, i) => {
    const j = record(entry, `judges[${i}]`);
    return {
      name: str(j.name, `judges[${i}].name`),
      email: optStr(j.email, `judges[${i}].email`),
      division: optStr(j.division, `judges[${i}].division`),
    };
  });
  if (judges.length === 0) fail("judges", "at least one judge");

  oneDivision([...teams, ...judges]);

  const board = array(root.board, "board").map((entry, i) => {
    const b = record(entry, `board[${i}]`);
    return { name: str(b.name, `board[${i}].name`), email: optStr(b.email, `board[${i}].email`) };
  });
  // Without a board member there is nobody to attribute a lock to, and no board link to hand out.
  if (board.length === 0) fail("board", "at least one board member");

  const registration = ((): CompConfig["registration"] => {
    if (root.registration === undefined || root.registration === null) return undefined;
    const r = record(root.registration, "registration");

    const maxRosterSize = optInt(r.maxRosterSize, "registration.maxRosterSize");
    if (maxRosterSize !== undefined && maxRosterSize <= 0) {
      fail("registration.maxRosterSize", "a value above zero");
    }

    if (r.division !== undefined) {
      fail(
        "registration.division",
        "no division field — a comp is one division (ADR-0010), so the form must not ask",
      );
    }

    const seen = new Set<string>();
    const fields =
      r.fields === undefined || r.fields === null
        ? undefined
        : array(r.fields, "registration.fields").map((f, i) =>
            customField(f, `registration.fields[${i}]`, seen),
          );

    return {
      // The waiver is the one thing a board cannot be given a default for: it is their text, and
      // `waiver_accepted_at` records that an applicant accepted *it*.
      waiverText: str(r.waiverText, "registration.waiverText"),
      requireAuditionUrl: r.requireAuditionUrl === true,
      maxRosterSize,
      fields,
    };
  })();

  /**
   * The duties a board can assign (C1). Authored as data for the fee schedule's reason: PRD §7.3
   * specifies this feature in one line and names no duties, so the list is a board's to state.
   *
   * An empty list and an absent one are collapsed to the same thing, `registration`'s reason: a
   * board that wrote `"duties": []` has said exactly what a board that wrote nothing said.
   */
  const duties = ((): CompConfig["duties"] => {
    if (root.duties === undefined || root.duties === null) return undefined;

    const seen = new Set<string>();
    const parsed = array(root.duties, "duties").map((d, i) => {
      const path = `duties[${i}]`;
      const raw = record(d, path);

      const id = str(raw.id, `${path}.id`);
      // The same regex custom fields use, deliberately shared rather than copied: a duty id is a
      // storage key for exactly a custom field id's reason, and two regexes would drift.
      if (!FIELD_ID.test(id)) {
        fail(`${path}.id`, "a lowercase key like `door_greeter` — it is the key assignments store");
      }
      if (seen.has(id)) fail(`${path}.id`, `an id no other duty uses (not "${id}" twice)`);
      seen.add(id);

      return {
        id,
        label: str(raw.label, `${path}.label`),
        category: oneOf(raw.category, DUTY_CATEGORIES, `${path}.category`),
        swaRequired: raw.swaRequired === true,
        help: optStr(raw.help, `${path}.help`),
      };
    });

    return parsed.length === 0 ? undefined : parsed;
  })();


  /**
   * G2's buffers, authored as data for the fee schedule's and the duty vocabulary's reason — and
   * with a louder warning than either. `docs/INTAKE.md` Part 3 asked a board for these numbers
   * *before* the engine was written, and said why the ordering mattered: "five numbers is a small
   * enough guess to be wrong about cheaply. A run-of-show is not five numbers, and a wrong one is not
   * discovered by a treasurer in April. It is discovered on stage."
   *
   * So **nothing here has a default.** A comp that has not written its run of show down has no
   * `schedule` at all and the screen says so; a comp that has written down half of one gets stated
   * gaps. The one thing the parser will not do is invent a number, because a buffer nobody chose is
   * indistinguishable on a screen from one somebody did.
   */
  const schedule = ((): CompConfig["schedule"] => {
    if (root.schedule === undefined || root.schedule === null) return undefined;
    const raw = record(root.schedule, "schedule");

    const roomIds = new Set<string>();
    const rooms = array(raw.rooms ?? [], "schedule.rooms").map((room, i) => {
      const path = `schedule.rooms[${i}]`;
      const entry = record(room, path);
      const id = str(entry.id, `${path}.id`);
      if (!FIELD_ID.test(id)) {
        fail(`${path}.id`, "a lowercase key like `green_room` — it is the key a segment stores");
      }
      if (roomIds.has(id)) fail(`${path}.id`, `an id no other room uses (not "${id}" twice)`);
      roomIds.add(id);
      return { id, label: str(entry.label, `${path}.label`) };
    });

    // A room a segment names must be a room the comp declared. The alternative is a timeline that
    // sends a liaison to a space this venue does not have, which is a sentence nobody reads twice.
    const roomOf = (value: unknown, path: string): string | null => {
      const id = optStr(value, path);
      if (id === undefined) return null;
      if (!roomIds.has(id)) fail(path, `one of the rooms this comp declared (not "${id}")`);
      return id;
    };

    const kinds = new Set<string>();
    const teamBuffers = array(raw.teamBuffers ?? [], "schedule.teamBuffers").map((rule, i) => {
      const path = `schedule.teamBuffers[${i}]`;
      const entry = record(rule, path);
      const kind = oneOf(entry.kind, TEAM_SEGMENT_KINDS, `${path}.kind`);
      if (kinds.has(kind)) fail(`${path}.kind`, `a kind no other buffer uses (not "${kind}" twice)`);
      kinds.add(kind);
      return {
        kind,
        durationMinutes: optInt(entry.durationMinutes, `${path}.durationMinutes`) ?? null,
        endsBeforePerformance:
          optInt(entry.endsBeforePerformance, `${path}.endsBeforePerformance`) ?? null,
        room: roomOf(entry.room, `${path}.room`),
      };
    });

    const fixtureIds = new Set<string>();
    const compSegments = array(raw.compSegments ?? [], "schedule.compSegments").map((seg, i) => {
      const path = `schedule.compSegments[${i}]`;
      const entry = record(seg, path);
      const id = str(entry.id, `${path}.id`);
      if (!FIELD_ID.test(id)) fail(`${path}.id`, "a lowercase key like `dinner`");
      if (fixtureIds.has(id)) fail(`${path}.id`, `an id no other segment uses (not "${id}" twice)`);
      fixtureIds.add(id);
      return {
        kind: oneOf(entry.kind, COMP_SEGMENT_KINDS, `${path}.kind`),
        id,
        label: str(entry.label, `${path}.label`),
        startsAtMinute: int(entry.startsAtMinute, `${path}.startsAtMinute`),
        durationMinutes: optInt(entry.durationMinutes, `${path}.durationMinutes`) ?? null,
        room: roomOf(entry.room, `${path}.room`),
        // Stated rather than defaulted, because both answers are wrong for the other case: food
        // ordered for a clock time does not move when the show slips, and a judges' cutoff does.
        movesWithShow: entry.movesWithShow === true,
      };
    });

    const slackIds = new Set<string>();
    const slack = array(raw.slack ?? [], "schedule.slack").map((pool, i) => {
      const path = `schedule.slack[${i}]`;
      const entry = record(pool, path);
      const id = str(entry.id, `${path}.id`);
      if (!FIELD_ID.test(id)) fail(`${path}.id`, "a lowercase key like `filler_act`");
      if (slackIds.has(id)) fail(`${path}.id`, `an id no other pool uses (not "${id}" twice)`);
      slackIds.add(id);
      return { id, label: str(entry.label, `${path}.label`), minutes: int(entry.minutes, `${path}.minutes`) };
    });

    return {
      anchor: str(raw.anchor, "schedule.anchor"),
      timezone: str(raw.timezone, "schedule.timezone"),
      firstSlotAtMinute: int(raw.firstSlotAtMinute, "schedule.firstSlotAtMinute"),
      slotMinutes: optInt(raw.slotMinutes, "schedule.slotMinutes") ?? null,
      changeoverMinutes: optInt(raw.changeoverMinutes, "schedule.changeoverMinutes") ?? 0,
      rooms,
      teamBuffers,
      compSegments,
      slack,
    };
  })();

  const feeSchedule = ((): FeeScheduleConfig | undefined => {
    if (root.feeSchedule === undefined || root.feeSchedule === null) return undefined;
    const f = record(root.feeSchedule, "feeSchedule");

    // ADR-0002 stops being a convention here. A config saying 70.5 means $70.50 to whoever wrote it
    // and 70.5 cents to `int`, and the difference is only ever discovered on a bank statement -- so
    // it is refused at the door, naming the path, rather than rounded into a number nobody chose.
    const cents = (key: keyof FeeScheduleConfig): number => {
      const value = optInt(f[key], `feeSchedule.${key}`) ?? 0;
      if (value < 0) fail(`feeSchedule.${key}`, "a value of zero or more");
      return value;
    };

    const lateFeeCents = cents("lateFeeCents");
    const lateAfter = optStr(f.lateAfter, "feeSchedule.lateAfter");

    if (lateAfter !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(lateAfter)) {
      fail("feeSchedule.lateAfter", "an ISO date (YYYY-MM-DD)");
    }
    // Each half is useless without the other, and a config carrying one is a board that meant to
    // charge a late fee and will not find out it did not until nobody is charged one.
    if (lateFeeCents > 0 && lateAfter === undefined) {
      fail("feeSchedule.lateAfter", "a date, because lateFeeCents is set — a late fee with no date never applies");
    }
    if (lateAfter !== undefined && lateFeeCents === 0) {
      fail("feeSchedule.lateFeeCents", "an amount, because lateAfter is set — a date with no fee charges nothing");
    }

    return {
      perDancerCents: cents("perDancerCents"),
      perRoomCents: cents("perRoomCents"),
      depositCents: cents("depositCents"),
      lateFeeCents,
      lateAfter,
    };
  })();

  return {
    org: { name: str(org.name, "org.name"), slug: str(org.slug, "org.slug") },
    comp: {
      name: str(comp.name, "comp.name"),
      slug: str(comp.slug, "comp.slug"),
      compDate: optStr(comp.compDate, "comp.compDate"),
      venue: optStr(comp.venue, "comp.venue"),
      status: comp.status === undefined ? "live" : oneOf(comp.status, COMP_STATUSES, "comp.status"),
    },
    rubric: {
      name: str(rubric.name, "rubric.name"),
      normalization: oneOf(rubric.normalization, NORMALIZATIONS, "rubric.normalization"),
      tiebreakers,
      criteria,
    },
    teams,
    judges: judges.map(({ name, email }) => ({ name, email })),
    board,
    registration,
    duties,
    schedule,
    feeSchedule,
  };
};
