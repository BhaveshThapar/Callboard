import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
