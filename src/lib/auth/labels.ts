/**
 * The board's de-identified name for a judge. Pure and DB-free so it unit-tests without
 * DATABASE_URL; `scope.ts` is what reads `label_seq` and applies it.
 */

/**
 * The board's window onto a judge *beside what they entered*. Note the absence of `name`: the same
 * technique `JudgeTeamView` uses for blind judging, pointed the other way. A judge whose scores can
 * be read off next to their name is a judge who stops scoring honestly, and every export and audit
 * surface therefore takes this type instead of `BoardJudgeView`.
 */
export type JudgeLabelView = { assignmentId: string; label: string };

export const judgeLabel = (labelSeq: number): string => `Judge ${labelSeq}`;
