import { isDeepStrictEqual } from "node:util";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deductions, judgeAssignments, rubricCriteria, rubrics, scores, SCOREABLE_STATUSES, tabRuns, teams } from "@/db/schema";
import { tabulate } from "@/lib/tabulation";
import type {
  Criterion,
  DeductionInput,
  Rubric,
  ScoreInput,
  TabulationInput,
  TabulationResult,
} from "@/lib/tabulation/types";

const SCOREABLE = SCOREABLE_STATUSES;

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
    // Joined to `teams` rather than filtered on `scores.comp_id` alone. A score row carries its own
    // `comp_id` and a bare team FK, so on its own it can name a team that belongs to another comp,
    // or one this comp has since dropped -- and either would be ranked.
    db
      .select({
        judgeId: scores.judgeAssignmentId,
        teamId: scores.teamId,
        criterionId: scores.criterionId,
        rawValue: scores.rawValue,
      })
      .from(scores)
      .innerJoin(teams, eq(teams.id, scores.teamId))
      .where(
        and(
          eq(scores.compId, compId),
          eq(teams.compId, compId),
          inArray(teams.status, [...SCOREABLE]),
        ),
      ),
    db
      .select({ teamId: deductions.teamId, points: deductions.points, reason: deductions.reason })
      .from(deductions)
      .innerJoin(teams, eq(teams.id, deductions.teamId))
      .where(
        and(
          eq(deductions.compId, compId),
          eq(teams.compId, compId),
          inArray(teams.status, [...SCOREABLE]),
        ),
      ),
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
  seq: number;
  lockedAt: Date;
  results: TabulationResult;
  inputs: TabulationInput;
  config: Rubric;
  supersedesId: string | null;
  overrideReason: string | null;
};

/**
 * How many times this comp has been locked. `seq` orders runs globally and is not this number:
 * it never resets, so the first lock of a fresh comp can carry any `seq` at all. The board is told
 * "run 2 supersedes run 1", which is a fact about the comp, not about the table.
 */
export const runCount = async (compId: string): Promise<number> => {
  const [row] = await db
    .select({ n: count() })
    .from(tabRuns)
    .where(eq(tabRuns.compId, compId));

  return row?.n ?? 0;
};

export const latestLockedRun = async (compId: string): Promise<LockedRun | null> => {
  const [run] = await db
    .select()
    .from(tabRuns)
    .where(eq(tabRuns.compId, compId))
    .orderBy(desc(tabRuns.seq))
    .limit(1);

  return run
    ? {
        id: run.id,
        seq: run.seq,
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
 * Freezes the inputs, the rubric, and the computed results into one row.
 * A second lock never mutates the first: it supersedes it and must say why.
 *
 * The first lock reads the live tables. **An override does not.** It takes the superseded run's
 * frozen `inputs` and `config` as its base and appends only the deductions its caller just wrote --
 * because "scores are immutable after a lock" has to mean the correction cannot see a score the
 * locked result did not. Re-reading the tables here would let anything written since the lock enter
 * the corrected result silently: a judge whose submission lost the race with the lock button, a
 * rubric weight edited afterwards, a team's status changed. Each run would still reproduce from its
 * own row, so the audit trail could never show it -- both runs verify while describing different
 * worlds. The board's "no deduction, re-tabulate only" correction is the case that names the bug:
 * it is supposed to be a no-op.
 *
 * The new deductions are passed in rather than diffed out of the table because `DeductionInput`
 * carries no id and no timestamp, so two identical deductions are indistinguishable in a snapshot.
 * Appending what the caller wrote sidesteps that, and keeps `TabulationInput` unchanged.
 */
export const lockResults = async (
  compId: string,
  options: {
    lockedByPersonId?: string;
    overrideReason?: string;
    addDeductions?: DeductionInput[];
  } = {},
): Promise<LockedRun> => {
  const previous = await latestLockedRun(compId);

  if (previous && !options.overrideReason) {
    throw new Error("results are already locked; an override requires a reason");
  }

  const { input, rubric } = previous
    ? {
        input: {
          ...previous.inputs,
          deductions: [...previous.inputs.deductions, ...(options.addDeductions ?? [])],
        },
        rubric: previous.config,
      }
    : await (async () => {
        const [built, loaded] = await Promise.all([
          buildTabulationInput(compId),
          getRubric(compId),
        ]);
        return { input: built, rubric: loaded };
      })();

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
    seq: run.seq,
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

const scoreKey = (score: ScoreInput): string =>
  `${score.judgeId}:${score.teamId}:${score.criterionId}:${score.rawValue}`;

/**
 * Scores sitting in the table that no locked run counts, and none ever will.
 *
 * `submitScores` refuses to write once a run exists, but that check and that insert are two acts
 * over a driver with no transactions, so a judge submitting as the lock lands can still get a row
 * in. Since an override now replays the frozen snapshot instead of re-reading the tables, that row
 * is not folded into the next correction either -- which is the correct reading of "scores are
 * immutable after a lock", and precisely why it must not be silent. The board is owed the sentence
 * "a score arrived that no result counts", not a quietly different set of placements.
 *
 * Compared against the snapshot rather than against `locked_at`, because a timestamp would miss the
 * one case this exists for: a score landing after `buildTabulationInput` has read the table but
 * before the run row is written carries a `submitted_at` *earlier* than the lock it missed.
 */
export const scoresOutsideChain = async (compId: string, head: LockedRun): Promise<number> => {
  const live = await buildTabulationInput(compId);
  const counted = new Set(head.inputs.scores.map(scoreKey));
  return live.scores.filter((score) => !counted.has(scoreKey(score))).length;
};
