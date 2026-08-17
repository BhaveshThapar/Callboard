import { sql } from "drizzle-orm";
import {
  check,
  integer,
  json,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
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
 * The statuses that take the stage — G1's draw, and the fourth list equal to the other three.
 *
 * The question is *who is in the running order*, and it is genuinely not *who is ranked*. PRD §9 G6
 * names filler acts and exhibition padding as engineered slack: an exhibition set occupies a slot, is
 * walked by a liaison and pushed to a phone like any other, and **is not placed**. The day a comp
 * enters one, this list and `SCOREABLE_STATUSES` come apart — and sharing a constant then would make
 * an exhibition team turn up in the placements, which is ADR-0009's own bug through a new door.
 *
 * Equal today, and none of the four may alias another, for the reason written above each of them.
 */
export const PERFORMING_STATUSES = ["accepted", "competing"] as const;

/**
 * One definition, because two things have to agree on the string and neither can derive it: the
 * index itself, and `apply`, which retries when a concurrent application takes the bid code it was
 * about to use. Same discipline as `CHAIN_INDEXES` in `./scores`, and for the same reason — the
 * database is what actually refuses, so the code has to name the refusal exactly.
 */
export const TEAMS_BID_CODE_UNIQUE = "teams_comp_bid_code_unique";

/**
 * G1's guarantee: two teams cannot hold the same slot in the running order.
 *
 * **`DEFERRABLE INITIALLY DEFERRED`, and that is not a preference — a plain unique refuses a
 * reorder.** Moving one act up the running order is a *trade*: two teams exchange positions. Postgres
 * checks a non-deferred unique index as each row is written, so the single `UPDATE` that performs the
 * trade transiently holds two teams at the same position and is rejected. Probed on `dev` rather than
 * reasoned about: the partial unique index this started as failed with `duplicate key value violates
 * unique constraint` on the first swap, the deferrable constraint passes it, and both still refuse a
 * genuine duplicate.
 *
 * Deferred to *commit*, and `db` has no transactions ([ADR-0012](../../../docs/decisions/0012-transactions-for-writes-that-span-statements.md)),
 * so every statement is its own implicit transaction and the check lands at the end of the one
 * `UPDATE`. That is what keeps a reorder one statement and keeps the sanctioned `withTransaction`
 * caller count at four: *these two rows exchange positions* is an invariant that spans two **rows**,
 * not two statements, and the database is a better place to say so than a transaction would be.
 *
 * Not partial. `NULL` means *not drawn yet*, Postgres already treats NULLs as distinct, and a partial
 * clause cannot be attached to a table constraint — so the whole undrawn roster coexists for free.
 * Probed too, because "for free" is the kind of claim that is worth ten seconds.
 *
 * Named here for `TEAMS_BID_CODE_UNIQUE`'s reason: `db:doctor` looks it up, and the guarantee lives
 * in the database, so the code cannot assume it is there. `redraw` writes `1..N` by construction, so
 * this can only fire on two board members drawing at once — the case a check-then-write in
 * application code would miss, and the reason it is a constraint rather than a guard.
 */
export const TEAMS_SHOW_ORDER_UNIQUE = "teams_comp_performance_order_unique";

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
    /**
     * The Friday-night draw (G1), and **the one definition of the running order.**
     *
     * `docs/DATA_MODEL.md` designed a `show_order` table — `comp_id, team_id, position` — which is
     * this column with extra steps. It was not built ([ADR-0023](../../../docs/decisions/0023-the-draw-is-a-column-not-a-table.md)):
     * the column already existed, the judge window already ordered by it, and it had **no writer in
     * the product at all**, so the draw got the write path it was missing rather than a second place
     * to disagree about which team dances third.
     *
     * Null means *not drawn yet*, which is every team until the mixer game has run. It is not zero
     * and it is not "last".
     */
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
    /**
     * Declared plain here and made `DEFERRABLE INITIALLY DEFERRED` in the migration, because drizzle
     * has no way to express deferrability. That split is safe rather than merely tolerable: drizzle
     * does not model the property, so it never appears in a diff and `db:generate` will not try to
     * take it away again. The reason it must be deferred is on `TEAMS_SHOW_ORDER_UNIQUE` above, and
     * `db:doctor` verifies the constraint by name — so a database that lost it says so out loud
     * rather than silently letting two teams hold slot four.
     */
    unique(TEAMS_SHOW_ORDER_UNIQUE).on(t.compId, t.performanceOrder),
    check(
      "teams_status_check",
      sql`${t.status} in ${sql.raw(`(${TEAM_STATUSES.map((s) => `'${s}'`).join(",")})`)}`,
    ),
  ],
);
