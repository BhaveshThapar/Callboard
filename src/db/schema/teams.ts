import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { comps } from "./orgs";

export type TeamStatus = "applied" | "waitlisted" | "accepted" | "dropped" | "competing";

/**
 * The statuses that place. One definition, because it decides two different things that must agree:
 * which teams a judge may score, and which teams the tabulator ranks. When those drifted apart, a
 * `dropped` team kept the scores it had already been given and went on placing with them.
 */
export const SCOREABLE_STATUSES = ["accepted", "competing"] as const;

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("teams_comp_bid_code_unique").on(t.compId, t.bidCode),
    check(
      "teams_status_check",
      sql`${t.status} in ('applied','waitlisted','accepted','dropped','competing')`,
    ),
  ],
);
