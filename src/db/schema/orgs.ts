import { check, date, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type CompStatus = "draft" | "open" | "live" | "complete";
export type CompRole = "board" | "liaison" | "judge" | "captain" | "attendee";

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
    /** Same primitive as a judge token, one per comp. Authorizes the tab view and the lock. */
    boardTokenHash: text("board_token_hash").notNull().unique(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("people_org_email_unique").on(t.orgId, t.email)],
);

/** A person can hold several roles at one comp: a board member who also liaises. */
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
