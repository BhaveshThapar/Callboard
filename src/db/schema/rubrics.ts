import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { NormalizationMethod, Tiebreaker } from "@/lib/tabulation/types";
import { comps } from "./orgs";

/** Rubrics are data. Fusion weights choreography; classical uses different criteria entirely. */
export const rubrics = pgTable(
  "rubrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalization: text("normalization").$type<NormalizationMethod>().notNull().default("zscore"),
    tiebreakers: jsonb("tiebreakers").$type<Tiebreaker[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("rubrics_normalization_check", sql`${t.normalization} in ('raw','zscore','rank')`),
  ],
);

export const rubricCriteria = pgTable(
  "rubric_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubrics.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    maxPoints: integer("max_points").notNull(),
    /** Basis points. 10000 = 1.0x. Integer so weighting never introduces float drift. */
    weightBp: integer("weight_bp").notNull().default(10_000),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    check("rubric_criteria_max_points_check", sql`${t.maxPoints} > 0`),
    check("rubric_criteria_weight_check", sql`${t.weightBp} >= 0`),
  ],
);
