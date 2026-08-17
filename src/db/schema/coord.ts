import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { comps, DUTY_CATEGORIES, people } from "./orgs";
import type { DutyCategory } from "./orgs";
import { teams } from "./teams";

/**
 * The index names, in one place, for `CHAIN_INDEXES`' reason: the schema, the write path that reads
 * the refusal, and `db:doctor` must agree on the strings, and none of the three can derive them.
 */
export const ASSIGNMENT_CONSTRAINTS = {
  /** One live duty per person per team. A double-clicked assign button is the second one. */
  liveDuty: "assignments_live_unique",
  /** The same rule for a duty about no team, which needs its own index — see below. */
  liveDutyNoTeam: "assignments_live_no_team_unique",
} as const;

export const ASSIGNMENT_CONSTRAINT_NAMES: readonly string[] = Object.values(ASSIGNMENT_CONSTRAINTS);

/**
 * Person ↔ duty ↔ time. PRD §7.3, and the table `comp_roles` was kept for and could not be:
 * `comp_roles` had no duty column and no time columns, so it could express neither *what* nor
 * *when*, which is the whole question C1 answers.
 *
 * **`person_id` is a bare FK**, exactly as `scores.team_id` is, so the database will happily take an
 * assignment naming somebody at another comp. That is what `addDeductionAction` cost before it
 * resolved its claim: the write succeeds, the actor is told it worked, and it counts for nothing.
 * Every write here resolves its `personId` against a scoped read first.
 *
 * `duty_id` keys into `comps.duties` rather than a table, for `custom_answers`' reason: the config
 * is both the vocabulary and the labels it is displayed under, so there is one definition of what
 * this comp asked somebody to do, and it is the one that survives to be read a year later.
 * `category` is denormalized off that config because the CHECK below and the timing derivations in
 * G2/G4 both need it in SQL, and a json lookup per row is not a scope key.
 */
export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    dutyId: text("duty_id").notNull(),
    category: text("category").$type<DutyCategory>().notNull(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    note: text("note"),

    /**
     * Three events, and all three are timestamps rather than booleans — `waiver_accepted_at` and
     * `reconciled_at`'s reason, which is that a boolean records a claim and a timestamp records an
     * event. DATA_MODEL designed this as `swa_trained boolean`; that is amended here, because *when
     * was this person trained* is the question a board actually has to answer.
     *
     * `swa_trained_at` is the board's. The other two are the liaison's, and are the only writes in
     * this product a liaison makes.
     */
    swaTrainedAt: timestamp("swa_trained_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdByPersonId: uuid("created_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Revoked, never `DELETE` — `charges.voided_at`'s argument applied to a person instead of a
     * team. Deleting a duty somebody already acknowledged destroys the record that they were told
     * to be at the door at four, which is exactly the record a board needs when nobody was.
     */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    /** Derived from `DUTY_CATEGORIES`, `audit_log_actor_kind_check`'s discipline: a fifth category
        is a migration rather than a type edit, and the list is never written down twice. */
    check(
      "assignments_category_check",
      sql`${t.category} in ${sql.raw(`(${DUTY_CATEGORIES.map((c) => `'${c}'`).join(",")})`)}`,
    ),

    /**
     * A duty about a team has one, and a duty about anything else has none. `memberships`' captain
     * CHECK verbatim: the alternative is a `team` duty pointing nowhere, which G4 would derive a
     * timeline for and find no slot.
     */
    check("assignments_team_check", sql`(${t.category} = 'team') = (${t.teamId} is not null)`),

    /** An end with no beginning is not a window, and one that ends before it starts is not either. */
    check(
      "assignments_window_check",
      sql`${t.endsAt} is null or (${t.startsAt} is not null and ${t.endsAt} > ${t.startsAt})`,
    ),

    /** Completed without acknowledged is a state no path can produce and nobody could explain. */
    check(
      "assignments_progress_check",
      sql`${t.completedAt} is null or ${t.acknowledgedAt} is not null`,
    ),

    /**
     * **Two partial indexes, not one, and the split is forced rather than chosen.** Postgres treats
     * NULLs as distinct, so a single unique over `(comp, person, duty, team)` would constrain
     * team-scoped duties and silently let two identical `general` duties stack on one person.
     *
     * The pair splits on `team_id is null`, which `assignments_team_check` has already made
     * equivalent to `category = 'team'` — so this is the same rule expressed twice by necessity, not
     * a second rule that could drift from the first.
     */
    uniqueIndex(ASSIGNMENT_CONSTRAINTS.liveDuty)
      .on(t.compId, t.personId, t.dutyId, t.teamId)
      .where(sql`revoked_at is null and team_id is not null`),
    uniqueIndex(ASSIGNMENT_CONSTRAINTS.liveDutyNoTeam)
      .on(t.compId, t.personId, t.dutyId)
      .where(sql`revoked_at is null and team_id is null`),

    /** The liaison's own read: every duty for one person at one comp. */
    index("assignments_comp_person_idx").on(t.compId, t.personId),
  ],
);
