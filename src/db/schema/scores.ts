import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { check, integer, json, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { Rubric, TabulationInput, TabulationResult } from "@/lib/tabulation/types";
import { comps, people } from "./orgs";
import { rubricCriteria, rubrics } from "./rubrics";
import { teams } from "./teams";

/**
 * A judge's claim on a comp. The raw token lives only in the URL we hand them;
 * we store its sha256. Revoke by setting `revokedAt`. No password, no app install.
 */
export const judgeAssignments = pgTable("judge_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  compId: uuid("comp_id")
    .notNull()
    .references(() => comps.id, { onDelete: "cascade" }),
  personId: uuid("person_id")
    .notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  division: text("division"),
  tokenHash: text("token_hash").notNull().unique(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scores = pgTable(
  "scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    judgeAssignmentId: uuid("judge_assignment_id")
      .notNull()
      .references(() => judgeAssignments.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id")
      .notNull()
      .references(() => rubricCriteria.id, { onDelete: "cascade" }),
    rawValue: integer("raw_value").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("scores_judge_team_criterion_unique").on(t.judgeAssignmentId, t.teamId, t.criterionId),
    check("scores_raw_value_check", sql`${t.rawValue} >= 0`),
  ],
);

/** Objective penalties, recorded against the team rather than against any one judge. */
export const deductions = pgTable(
  "deductions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    createdByPersonId: uuid("created_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("deductions_points_check", sql`${t.points} > 0`)],
);

/**
 * A locked result. `inputs` and `config` are the frozen arguments to `tabulate()`;
 * `results` is what it returned. Re-running the function against `inputs` must reproduce
 * `results` exactly, which is the whole of the dispute-proofing claim.
 *
 * Corrections never mutate: they insert a new row with `supersedesId` and an attributed reason.
 *
 * These three columns are `json`, not `jsonb`: jsonb reorders object keys and collapses
 * duplicates, so it cannot promise a snapshot comes back as the bytes that went in.
 */
export const tabRuns = pgTable("tab_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  compId: uuid("comp_id")
    .notNull()
    .references(() => comps.id, { onDelete: "cascade" }),
  rubricId: uuid("rubric_id")
    .notNull()
    .references(() => rubrics.id, { onDelete: "restrict" }),
  inputs: json("inputs").$type<TabulationInput>().notNull(),
  config: json("config").$type<Rubric>().notNull(),
  results: json("results").$type<TabulationResult>().notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
  lockedByPersonId: uuid("locked_by_person_id").references(() => people.id, {
    onDelete: "set null",
  }),
  supersedesId: uuid("supersedes_id").references((): AnyPgColumn => tabRuns.id, {
    onDelete: "set null",
  }),
  overrideReason: text("override_reason"),
});
