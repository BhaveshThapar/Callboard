import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deductions, judgeAssignments, rubricCriteria, rubrics, scores, tabRuns, teams } from "@/db/schema";
import { tabulate } from "@/lib/tabulation";
import type { Criterion, Rubric, TabulationInput, TabulationResult } from "@/lib/tabulation/types";

const SCOREABLE = ["accepted", "competing"] as const;

export const getRubric = async (compId: string): Promise<Rubric> => {
  const [rubric] = await db
    .select()
    .from(rubrics)
    .where(eq(rubrics.compId, compId))
    .orderBy(rubrics.createdAt)
    .limit(1);

  if (!rubric) throw new Error(`comp ${compId} has no rubric`);

  const criteria: Criterion[] = await db
    .select({
      id: rubricCriteria.id,
      label: rubricCriteria.label,
      maxPoints: rubricCriteria.maxPoints,
      weightBp: rubricCriteria.weightBp,
      sortOrder: rubricCriteria.sortOrder,
    })
    .from(rubricCriteria)
    .where(eq(rubricCriteria.rubricId, rubric.id))
    .orderBy(rubricCriteria.sortOrder);

  return {
    id: rubric.id,
    normalization: rubric.normalization,
    tiebreakers: rubric.tiebreakers,
    criteria,
  };
};

export const buildTabulationInput = async (compId: string): Promise<TabulationInput> => {
  const [teamRows, judgeRows, scoreRows, deductionRows] = await Promise.all([
    db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.compId, compId), inArray(teams.status, [...SCOREABLE]))),
    db.select({ id: judgeAssignments.id }).from(judgeAssignments).where(eq(judgeAssignments.compId, compId)),
    db
      .select({
        judgeId: scores.judgeAssignmentId,
        teamId: scores.teamId,
        criterionId: scores.criterionId,
        rawValue: scores.rawValue,
      })
      .from(scores)
      .where(eq(scores.compId, compId)),
    db
      .select({ teamId: deductions.teamId, points: deductions.points, reason: deductions.reason })
      .from(deductions)
      .where(eq(deductions.compId, compId)),
  ]);

  return {
    teams: teamRows.map((t) => t.id),
    judges: judgeRows.map((j) => j.id),
    scores: scoreRows,
    deductions: deductionRows,
  };
};

/** One judge's own scores, for prefilling their form. teamId -> criterionId -> raw value. */
export const judgeScores = async (
  judgeAssignmentId: string,
): Promise<Map<string, Map<string, number>>> => {
  const rows = await db
    .select({ teamId: scores.teamId, criterionId: scores.criterionId, rawValue: scores.rawValue })
    .from(scores)
    .where(eq(scores.judgeAssignmentId, judgeAssignmentId));

  const byTeam = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let byCriterion = byTeam.get(row.teamId);
    if (!byCriterion) {
      byCriterion = new Map();
      byTeam.set(row.teamId, byCriterion);
    }
    byCriterion.set(row.criterionId, row.rawValue);
  }
  return byTeam;
};

/** Standings as they stand right now. Not a lock, not a record — just the current arithmetic. */
export const liveStandings = async (compId: string): Promise<TabulationResult> => {
  const [input, rubric] = await Promise.all([buildTabulationInput(compId), getRubric(compId)]);
  return tabulate(input, rubric);
};

export type LockedRun = {
  id: string;
  lockedAt: Date;
  results: TabulationResult;
  inputs: TabulationInput;
  config: Rubric;
  supersedesId: string | null;
  overrideReason: string | null;
};

export const latestLockedRun = async (compId: string): Promise<LockedRun | null> => {
  const [run] = await db
    .select()
    .from(tabRuns)
    .where(eq(tabRuns.compId, compId))
    .orderBy(desc(tabRuns.lockedAt))
    .limit(1);

  return run
    ? {
        id: run.id,
        lockedAt: run.lockedAt,
        results: run.results,
        inputs: run.inputs,
        config: run.config,
        supersedesId: run.supersedesId,
        overrideReason: run.overrideReason,
      }
    : null;
};

/**
 * Freezes the current inputs, the rubric, and the computed results into one row.
 * A second lock never mutates the first: it supersedes it and must say why.
 */
export const lockResults = async (
  compId: string,
  options: { lockedByPersonId?: string; overrideReason?: string } = {},
): Promise<LockedRun> => {
  const [input, rubric, previous] = await Promise.all([
    buildTabulationInput(compId),
    getRubric(compId),
    latestLockedRun(compId),
  ]);

  if (previous && !options.overrideReason) {
    throw new Error("results are already locked; an override requires a reason");
  }

  const results = tabulate(input, rubric);

  const [run] = await db
    .insert(tabRuns)
    .values({
      compId,
      rubricId: rubric.id,
      inputs: input,
      config: rubric,
      results,
      lockedByPersonId: options.lockedByPersonId ?? null,
      supersedesId: previous?.id ?? null,
      overrideReason: options.overrideReason ?? null,
    })
    .returning();

  if (!run) throw new Error("failed to write tab_run");

  return {
    id: run.id,
    lockedAt: run.lockedAt,
    results: run.results,
    inputs: run.inputs,
    config: run.config,
    supersedesId: run.supersedesId,
    overrideReason: run.overrideReason,
  };
};

/** Re-runs the pure function against a locked snapshot. Used by the audit view and the e2e test. */
export const reproduce = (run: LockedRun): { matches: boolean; recomputed: TabulationResult } => {
  const recomputed = tabulate(run.inputs, run.config);
  return { matches: isDeepStrictEqual(recomputed, run.results), recomputed };
};
