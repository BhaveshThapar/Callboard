import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { comps } from "./orgs";

export type TeamStatus = "applied" | "waitlisted" | "accepted" | "dropped" | "competing";

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
