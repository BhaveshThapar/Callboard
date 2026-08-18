import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { comps, people } from "./orgs";

/**
 * One definition, for `CHAIN_INDEXES`' reason: the schema, the insert path and `db:doctor` all have
 * to agree on this string and none of them can derive it. The insert is a read-then-write of
 * `max(seq) + 1` on a driver with no transactions, so two board members entering a delay in the same
 * second **will** collide — and this index is what turns that into a retry rather than two rows
 * claiming to be the fourth thing that happened.
 */
export const SCHEDULE_DELAY_SEQ_UNIQUE = "schedule_delays_comp_seq_unique";

export const SCHEDULE_CONSTRAINT_NAMES: readonly string[] = [SCHEDULE_DELAY_SEQ_UNIQUE];


/**
 * G3 — "we are running N minutes behind", written down.
 *
 * **Append, never mutate**, and the same chain shape as `tab_runs`, `deposit_events` and
 * `message_events`: one row per statement of fact, ordered by `seq`, and the state of the world is
 * the fold of the whole chain rather than a column somebody overwrites. A delay is a thing that
 * happened at a time, and comp day is exactly when a board needs to be able to say *what did we tell
 * people, and when* — the same reason a score is never edited.
 *
 * **There is deliberately no `schedule_segments` table and no snapshot of the derived timeline.**
 * DATA_MODEL designed one; it is not built. A derived schedule is a *function* of three things this
 * database already holds — the draw (`teams.performance_order`), the buffers (`comps.schedule`) and
 * this chain — so storing it would create a second answer to a question that already has one, which
 * is the disagreement `db:doctor` exists to report. `tab_runs` freezes its inputs because a locked
 * placement is a claim that must survive the tables moving underneath it; a running order is a claim
 * about *right now*, and the honest version of it is the one derived from what is true right now.
 *
 * That is also what makes G5 cheap: a push is the difference between the fold at `seq n-1` and the
 * fold at `seq n`, and both are derivable without either having been stored.
 */
export const scheduleDelays = pgTable(
  "schedule_delays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    /** 1-based, dense, per comp. `schedule_delays_seq_unique` is what stops two boards sharing one. */
    seq: integer("seq").notNull(),
    /**
     * Signed, because a show can catch up. A negative delay is a board saying the running order has
     * pulled time back — an act got cut, a set ran short — and refusing to represent it would mean
     * the only way to record catching up is to edit history, which this table exists not to do.
     */
    minutes: integer("minutes").notNull(),
    /**
     * The running-order position this starts biting from.
     *
     * PRD §9 G3 says the delay input is *per segment*, and this is the honest reading of that for a
     * running order: a team that has already danced is not re-timed by the show slipping afterwards.
     * A single global offset would move somebody's completed call time, which is worse than useless
     * on a screen they are following.
     */
    fromPosition: integer("from_position").notNull(),
    /**
     * Why, in the board's words. Required and not nullable, for `override_reason`'s reason: the row
     * exists so somebody can reconstruct a day, and "20 minutes" with no cause reconstructs nothing.
     */
    reason: text("reason").notNull(),
    createdByPersonId: uuid("created_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex(SCHEDULE_DELAY_SEQ_UNIQUE).on(t.compId, t.seq),
    index("schedule_delays_comp_idx").on(t.compId, t.seq),
    check("schedule_delays_position_check", sql`${t.fromPosition} >= 1`),
    // Zero is not a delay. A row that moves nothing is noise in a record whose whole job is to say
    // what moved, and a board pressing the button with an empty field should be told, not obeyed.
    check("schedule_delays_minutes_check", sql`${t.minutes} <> 0`),
  ],
);
