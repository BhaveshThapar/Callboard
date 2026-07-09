export type JudgeRosterRow = { assignmentId: string; name: string; revoked: boolean };

export type JudgeProgress = {
  assignmentId: string;
  name: string;
  revoked: boolean;
  submitted: number;
  expected: number;
};

/**
 * Who the board still counts, and how far along they are.
 *
 * Revoking a judge kills their link, not their scores: what they already submitted stands and still
 * counts, because the record is append-only. So a revoked judge who scored stays on the roster,
 * flagged. A revoked judge who never scored -- a link killed because it leaked -- leaves entirely,
 * taking their share of the denominator with them.
 *
 * Both sides of the fraction are derived from this one roster. Deriving them separately is what
 * previously let a revoked judge's scores count toward the numerator while their expectation was
 * filtered out of the denominator, pushing the board past 100%.
 */
export const judgeProgress = (
  roster: readonly JudgeRosterRow[],
  submittedByAssignment: ReadonlyMap<string, number>,
  expectedPerJudge: number,
): JudgeProgress[] =>
  roster
    .map((judge) => ({
      ...judge,
      submitted: submittedByAssignment.get(judge.assignmentId) ?? 0,
      expected: expectedPerJudge,
    }))
    .filter((judge) => !judge.revoked || judge.submitted > 0);

export const progressTotals = (
  judges: readonly JudgeProgress[],
): { submitted: number; expected: number } => ({
  submitted: judges.reduce((total, judge) => total + judge.submitted, 0),
  expected: judges.reduce((total, judge) => total + judge.expected, 0),
});
