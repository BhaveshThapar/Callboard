import { check, date, json, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One definition: the type, `comps_status_check`, the config parser, and the board's own lifecycle
 * control all derive from this. `TEAM_STATUSES`' discipline, arrived at late — the parser held a
 * second copy of this list while nothing else needed one, and the moment a board could *write* the
 * column there were three places that had to agree on four strings.
 */
export const COMP_STATUSES = ["draft", "open", "live", "complete"] as const;

export type CompStatus = (typeof COMP_STATUSES)[number];
export type CompRole = "board" | "liaison" | "judge" | "captain" | "attendee";

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
 * A person can hold several roles at one comp: a board member who also liaises.
 *
 * **The one table in the schema with a writer and no reader**, and it is worth being explicit about
 * why rather than leaving it to be rediscovered. It authorizes nothing — `board_assignments` and
 * `judge_assignments` do that, per person, with a hashed token — so nothing on the scoring or money
 * path has any reason to consult it, and a read added merely to make it look used would be the kind
 * of thing ADR-0010 removed a column for.
 *
 * It is kept rather than dropped because it is the shape C1 needs (person ↔ duty ↔ comp), and the
 * seed writes it so that the record of who was involved in a comp survives the links being revoked.
 * If it is still readerless when the coordination work is actually scheduled, it should be dropped
 * then — a table that describes a plan is only worth its migration while the plan is live.
 */
export const compRoles = pgTable(
  "comp_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: text("role").$type<CompRole>().notNull(),
  },
  (t) => [
    unique("comp_roles_unique").on(t.compId, t.personId, t.role),
    check("comp_roles_role_check", sql`${t.role} in ('board','liaison','judge','captain','attendee')`),
  ],
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
