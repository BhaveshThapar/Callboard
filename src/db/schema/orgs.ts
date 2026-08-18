import { check, date, json, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ScheduleConfig } from "@/lib/schedule/types";

/**
 * One definition: the type, `comps_status_check`, the config parser, and the board's own lifecycle
 * control all derive from this. `TEAM_STATUSES`' discipline, arrived at late — the parser held a
 * second copy of this list while nothing else needed one, and the moment a board could *write* the
 * column there were three places that had to agree on four strings.
 */
export const COMP_STATUSES = ["draft", "open", "live", "complete"] as const;

export type CompStatus = (typeof COMP_STATUSES)[number];

export const CUSTOM_FIELD_TYPES = ["text", "longtext", "number", "select", "checkbox"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** What one answer can be. Narrow on purpose: an answer is evidence, not a document. */
export type CustomAnswer = string | number | boolean;

/**
 * One question a board adds to its own form. Boards ask things the product cannot anticipate —
 * prop requirements, arrival window, dietary counts — and the alternative to asking them here is a
 * second Google Form whose answers live somewhere the roster screen cannot reach.
 *
 * `id` is the key the answer is stored under, so it is the one field that must never change once a
 * comp has taken an application: renaming it orphans every answer already filed. `label` is what
 * the applicant reads and is safe to reword at any time. Keeping them separate is the whole reason
 * the id is required rather than derived from the label.
 */
export type CustomField = {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  help?: string;
  /** `select` only, and at least two — a choice of one is a statement, not a question. */
  options?: string[];
  /** `text` and `longtext` only. */
  maxLength?: number;
};

/**
 * The public registration form, as data. Null means the comp has no form at all, which is not the
 * same as a form that is closed — whether it *accepts* an application is `comps.status === 'open'`.
 *
 * No division field, on purpose: a comp is one division (ADR-0010), so an applicant has nothing to
 * choose and a field nothing reads is the mistake that ADR removed a column to fix.
 *
 * `fields` is the board's own half of the form. It is *also* the schema its answers are validated
 * against and the labels they are displayed under, so there is exactly one definition of what this
 * comp asked — which is what keeps an answer readable a year later, when the only record of the
 * question is the config that posed it.
 */
export type RegistrationConfig = {
  waiverText: string;
  requireAuditionUrl: boolean;
  maxRosterSize?: number;
  fields?: CustomField[];
};

/** Persists across years. This is the institutional memory a board cannot otherwise hand off. */
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What kind of thing a duty is, and therefore what derives from it. Four, and **each one names its
 * reader** — a category nothing reads is `judge_assignments.division` again, a column that looked
 * like an authorization key and authorized nothing (ADR-0010).
 *
 * - `team` — the duty is about one team, so it can hang off the show order. G4's per-person timeline.
 * - `judge` — what the judge-cutoff segment derives against (G2).
 * - `hospitality` — ADJ·4's filter.
 * - `general` — derives no timing, and says so. This is the honest category, not the leftover one.
 *
 * `venue`, `tech` and `other` were considered and refused on exactly that test: nothing would read
 * them, and `other` in particular means *we did not know*, which a CHECK cannot make true.
 *
 * The categories are the CHECK; the duty *names* are a board's own words in `comps.duties`. Same
 * split as `CUSTOM_FIELD_TYPES` (stable set) over `registration.fields` (the board's questions).
 */
export const DUTY_CATEGORIES = ["team", "judge", "hospitality", "general"] as const;

export type DutyCategory = (typeof DUTY_CATEGORIES)[number];

/**
 * One duty a board can assign, authored as data exactly like the fee schedule and the rubric.
 *
 * PRD §7.3 specifies C1 in one line — *"assignments + SWA-training checklist"* — and names no duties
 * at all. So the list is a board's to state rather than this repo's to guess, and a list that does
 * not fit these fields is a signal about the design rather than a bug in the parser: `CLAUDE.md`'s
 * own sentence about the fee schedule, transposed.
 *
 * `id` is the key an assignment stores, so it must never change once a duty has been assigned —
 * `CustomField.id`'s rule, and it reuses that rule's regex rather than a second one. `label` is what
 * a person reads and is safe to reword at any time.
 */
export type DutyConfig = {
  id: string;
  label: string;
  category: DutyCategory;
  /** Whether this duty requires the SWA training a board tracks. PRD §7.3's "checklist". */
  swaRequired: boolean;
  help?: string;
};

export const comps = pgTable(
  "comps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    compDate: date("comp_date"),
    venue: text("venue"),
    status: text("status").$type<CompStatus>().notNull().default("draft"),
    registration: json("registration").$type<RegistrationConfig>(),
    /** C1. Null and `[]` are the same fact and the parser collapses them, `registration`'s reason. */
    duties: json("duties").$type<DutyConfig[]>(),
    /**
     * The Gita's buffers (G2), authored as data exactly like the rubric, the fee schedule and the
     * duty vocabulary. `docs/INTAKE.md` promised a board this shape before the engine was written:
     * *"the buffers become configuration — the same shape your fee schedule and your rubric already
     * take, so the first real one to arrive is data rather than a migration."*
     *
     * **One column rather than four.** The anchor, the timezone, the rooms and the buffers are one
     * answer to one question — *how does your show run* — and splitting them across columns would
     * let a comp acquire a timezone with no anchor, or rooms nothing schedules into. `ScheduleConfig`
     * is defined in `src/lib/schedule/`, which owns the vocabulary; the schema imports it, the
     * direction `TabulationInput` and `FeeSchedule` already established.
     *
     * Null means this comp has not written its run of show down, which is every comp until a board
     * does — and until it does, the comp-day screen says so rather than deriving a schedule out of
     * defaults nobody chose.
     */
    schedule: json("schedule").$type<ScheduleConfig>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("comps_org_slug_unique").on(t.orgId, t.slug),
    check("comps_status_check", sql`${t.status} in ('draft','open','live','complete')`),
  ],
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    /**
     * Suppresses **broadcast** mail and nothing else ([ADR-0020]). A board is entitled to tell
     * somebody who owes them money that they owe it; a board is not entitled to keep announcing at
     * somebody who left. A timestamp rather than a boolean, for `waiver_accepted_at`'s reason: a
     * boolean records a claim and a timestamp records an event, and this is the one somebody would
     * be asked to produce.
     *
     * [ADR-0020]: ../../../docs/decisions/0020-a-message-sends-once.md
     */
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("people_org_email_unique").on(t.orgId, t.email)],
);

/**
 * A board member's claim on a comp. The same primitive as `judge_assignments`, and deliberately
 * per-person rather than per-comp: a lock and an override must name the human who authorized them
 * (PRD B6), and a link shared by the whole board can only ever name the board.
 */
export const boardAssignments = pgTable("board_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  compId: uuid("comp_id")
    .notNull()
    .references(() => comps.id, { onDelete: "cascade" }),
  personId: uuid("person_id")
    .notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
