import { sql } from "drizzle-orm";
import { check, integer, json, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { CustomAnswer } from "./orgs";
import { comps, people } from "./orgs";

/** One definition: the type, the check constraint, and the board's form all derive from this. */
export const TEAM_STATUSES = [
  "applied",
  "waitlisted",
  "accepted",
  "dropped",
  "competing",
] as const;

export type TeamStatus = (typeof TEAM_STATUSES)[number];

/**
 * The statuses that place. One definition, because it decides two different things that must agree:
 * which teams a judge may score, and which teams the tabulator ranks. When those drifted apart, a
 * `dropped` team kept the scores it had already been given and went on placing with them.
 */
export const SCOREABLE_STATUSES = ["accepted", "competing"] as const;

/**
 * The statuses that owe money. It equals `SCOREABLE_STATUSES` today and is deliberately **not** an
 * alias of it: they answer different questions, and a comp that decided to bill at `applied` would
 * otherwise start handing applicants places in the ranking.
 */
export const BILLABLE_STATUSES = ["accepted", "competing"] as const;

/**
 * The statuses a board's announcement reaches. A third list equal to the other two, and a third
 * question: *who is actually coming to this comp.*
 *
 * It must not alias either. A comp that decided to bill at `applied` would not thereby want to send
 * an applicant the parking instructions, and a comp that announced to its waitlist would not thereby
 * want the tabulator ranking them. Each of the three has its own way of being wrong, and the day one
 * of them moves is the day sharing a constant becomes a silent bug in the other two.
 *
 * `dropped` is excluded and that is the whole point of the list existing: telling a team that
 * withdrew where to park is the kind of thing a board never lives down.
 */
export const ANNOUNCEABLE_STATUSES = ["accepted", "competing"] as const;

/**
 * One definition, because two things have to agree on the string and neither can derive it: the
 * index itself, and `apply`, which retries when a concurrent application takes the bid code it was
 * about to use. Same discipline as `CHAIN_INDEXES` in `./scores`, and for the same reason — the
 * database is what actually refuses, so the code has to name the refusal exactly.
 */
export const TEAMS_BID_CODE_UNIQUE = "teams_comp_bid_code_unique";

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    school: text("school"),
    /** The anonymized identifier judges see. Blind judging is a projection, not a mode. */
    bidCode: text("bid_code").notNull(),
    status: text("status").$type<TeamStatus>().notNull().default("applied"),
    waitlistRank: integer("waitlist_rank"),
    rosterSize: integer("roster_size"),
    /**
     * Hotel rooms, for a comp whose schedule bills per room. Null means *not yet known*, which is
     * not zero: the generator must emit no hotel charge and a stated gap rather than a $0 one. A $0
     * hotel charge is a lie a treasurer will believe, and will find in April.
     */
    rooms: integer("rooms"),
    division: text("division"),
    performanceOrder: integer("performance_order"),
    /** Who registered this team. `people` is per-org, so a captain across two comps is one person. */
    contactPersonId: uuid("contact_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    auditionUrl: text("audition_url"),
    /**
     * When the waiver was accepted, not whether. A boolean records a claim; a timestamp records an
     * event, and this is the column a board would be asked to produce if anything ever went wrong.
     */
    waiverAcceptedAt: timestamp("waiver_accepted_at", { withTimezone: true }),
    /**
     * Answers to the questions this comp added to its own form, keyed by `CustomField.id`.
     *
     * `json`, not `jsonb`, for `tab_runs`' reason: jsonb reorders keys and collapses duplicates, and
     * what a team submitted should come back as what it submitted. Null for a seeded team and for a
     * comp that asked nothing, which are the same fact — there was no application to answer.
     *
     * A column rather than a table because an answer has no life of its own: it is never queried
     * across teams, never updated, and dies with the team it describes. The questions it is keyed
     * against live in `comps.registration`, which is the only thing that can say what was asked.
     */
    customAnswers: json("custom_answers").$type<Record<string, CustomAnswer>>(),
    /**
     * A4's materials half: what a team files *after* it is accepted.
     *
     * A URL rather than a file, following `audition_url`'s own precedent — this repo has five
     * runtime dependencies and no place to put a file, and a board asking for final music gets a
     * Drive or Dropbox link today because that is what boards actually exchange. Every write goes
     * through one `putMaterial` seam, so a blob store later is an implementation of that seam and
     * not a migration.
     */
    musicUrl: text("music_url"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    /**
     * When the team last filed, not whether — `waiver_accepted_at`'s reason. A board chasing
     * missing music needs to know who has never filed, and null is the only honest way to say it.
     */
    materialsSubmittedAt: timestamp("materials_submitted_at", { withTimezone: true }),
    /**
     * What the captain says their roster is now. **A claim, not a fact, and the distinction is the
     * whole design.**
     *
     * `roster_size` is what `planCharges` bills on, so a captain writing it directly would be a
     * captain editing their own invoice — down as easily as up, with nobody told. So the captain
     * writes here and the board's existing `setTeamBilling` is where a claim becomes a fact, in the
     * transaction that already re-bills. That adds no billing path and no fourth window; it is this
     * repo's own *a `teamId` on a form is a claim* rule applied one level up, to the number rather
     * than to the id.
     *
     * Cleared when the board acts, so a pending request means exactly *somebody is waiting on you*.
     */
    rosterSizeRequested: integer("roster_size_requested"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique(TEAMS_BID_CODE_UNIQUE).on(t.compId, t.bidCode),
    check(
      "teams_status_check",
      sql`${t.status} in ${sql.raw(`(${TEAM_STATUSES.map((s) => `'${s}'`).join(",")})`)}`,
    ),
  ],
);
