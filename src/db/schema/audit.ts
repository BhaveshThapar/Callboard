import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { comps, people } from "./orgs";

/**
 * One definition, and the CHECK below derives from it — `COMP_STATUSES`' discipline.
 *
 * It is a constraint rather than a bare column on purpose, and ADR-0016 calls that the good kind of
 * friction: a new kind of actor cannot be added by editing a type, which is exactly what you want of
 * the column that records who did what. `team` and `liaison` arrive with accounts in `0012`.
 */
export const ACTOR_KINDS = ["board", "judge", "team", "liaison", "system"] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

/**
 * Append-only. Every write that touches a score, a lock, or an override lands here.
 * This table is not instrumentation; it is the product. Paper cannot provide it.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    actorPersonId: uuid("actor_person_id").references(() => people.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_comp_at_idx").on(t.compId, t.at),
    check(
      "audit_log_actor_kind_check",
      sql`${t.actorKind} in ${sql.raw(`(${ACTOR_KINDS.map((k) => `'${k}'`).join(",")})`)}`,
    ),
  ],
);
