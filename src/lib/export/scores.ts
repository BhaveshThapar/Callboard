import { toCsv } from "./csv";
import { noteKey } from "./feedback";

/**
 * The board's own audit export: every judge's score on every criterion, under `Judge 1` / `Judge 2`
 * and never under a name. This is what a board reads to check the arithmetic, to answer a coach at
 * the tab table, and to see that one judge scored a team far off the other two.
 *
 * It stops at the board. `judges` maps to labels, so the name is not withheld from the file — it is
 * never fetched, and `JudgeLabelView` makes writing one here a compile error.
 */
export type ScoreAuditInput = {
  /** From the frozen `tab_runs.results`. */
  placements: readonly { teamId: string; place: number; deductionPoints: number }[];
  /** From the frozen `tab_runs.config`, in rubric order. */
  criteria: readonly { id: string; label: string }[];
  /** From the frozen `tab_runs.inputs`. `judgeId` is a judge_assignment id. */
  scores: readonly { judgeId: string; teamId: string; criterionId: string; rawValue: number }[];
  teams: ReadonlyMap<string, { name: string; bidCode: string }>;
  /** judge_assignment id -> "Judge 2", in panel order. Never a name. */
  judges: ReadonlyMap<string, string>;
};

/**
 * One row per (team, judge). Judges appear in panel order — the insertion order of `judges`, which
 * is `label_seq` — rather than sorted by label text, which would file Judge 10 ahead of Judge 2.
 *
 * Every number comes from the frozen snapshot, never from a fresh computation, so the file the
 * board audits against is the file the placements were announced from.
 */
export const toScoreAuditCsv = (input: ScoreAuditInput): string => {
  const headers = [
    "Place",
    "Team",
    "Bid code",
    "Judge",
    ...input.criteria.map((c) => c.label),
    "Judge total",
    "Team deduction",
  ];

  const byTeamJudge = new Map<string, Map<string, number>>();
  for (const score of input.scores) {
    const key = noteKey(score.judgeId, score.teamId);
    let byCriterion = byTeamJudge.get(key);
    if (!byCriterion) {
      byCriterion = new Map();
      byTeamJudge.set(key, byCriterion);
    }
    byCriterion.set(score.criterionId, score.rawValue);
  }

  const rows: string[][] = [];
  for (const placement of [...input.placements].sort((a, b) => a.place - b.place)) {
    const team = input.teams.get(placement.teamId);

    for (const [judgeId, label] of input.judges) {
      const byCriterion = byTeamJudge.get(noteKey(judgeId, placement.teamId));
      if (!byCriterion) continue;

      const values = input.criteria.map((c) => byCriterion.get(c.id));

      rows.push([
        String(placement.place),
        team?.name ?? placement.teamId,
        team?.bidCode ?? "",
        label,
        ...values.map((v) => (v === undefined ? "" : String(v))),
        String(values.reduce((sum: number, v) => sum + (v ?? 0), 0)),
        placement.deductionPoints > 0 ? `-${placement.deductionPoints}` : "0",
      ]);
    }
  }

  return toCsv(headers, rows);
};
