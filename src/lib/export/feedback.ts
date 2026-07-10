import { toCsv } from "./csv";

export type FeedbackInput = {
  /** From the frozen `tab_runs.results`. */
  placements: readonly { teamId: string; place: number; deductionPoints: number }[];
  /** From the frozen `tab_runs.config`, in rubric order. */
  criteria: readonly { id: string; label: string }[];
  /** From the frozen `tab_runs.inputs`. `judgeId` is a judge_assignment id. */
  scores: readonly { judgeId: string; teamId: string; criterionId: string; rawValue: number }[];
  teams: ReadonlyMap<string, { name: string; bidCode: string }>;
  judges: ReadonlyMap<string, string>;
  /** Keyed `judgeId:teamId`. Read live, because notes are deliberately not in the snapshot. */
  notes: ReadonlyMap<string, string>;
};

export const noteKey = (judgeId: string, teamId: string): string => `${judgeId}:${teamId}`;

/**
 * One row per (team, judge): what that judge gave, criterion by criterion, and what they wrote.
 * Ordered by placement, then by judge name, so a team reading its own rows sees them in a stable
 * order rather than in whatever order Postgres returned.
 *
 * Everything scored comes from the frozen snapshot. Only the note is read live -- it is not in the
 * snapshot by design -- and notes are refused after the lock, so both are fixed at the same moment.
 */
export const toFeedbackCsv = (input: FeedbackInput): string => {
  const headers = [
    "Place",
    "Team",
    "Bid code",
    "Judge",
    ...input.criteria.map((c) => c.label),
    "Judge total",
    "Team deduction",
    "Note",
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

  const judgeIds = [...input.judges.keys()].sort((a, b) =>
    (input.judges.get(a) ?? "").localeCompare(input.judges.get(b) ?? ""),
  );

  const rows: string[][] = [];
  for (const placement of [...input.placements].sort((a, b) => a.place - b.place)) {
    const team = input.teams.get(placement.teamId);

    for (const judgeId of judgeIds) {
      const key = noteKey(judgeId, placement.teamId);
      const byCriterion = byTeamJudge.get(key);
      if (!byCriterion) continue;

      const values = input.criteria.map((c) => byCriterion.get(c.id));
      const total = values.reduce((sum: number, v) => sum + (v ?? 0), 0);

      rows.push([
        String(placement.place),
        team?.name ?? placement.teamId,
        team?.bidCode ?? "",
        input.judges.get(judgeId) ?? judgeId,
        ...values.map((v) => (v === undefined ? "" : String(v))),
        String(total),
        placement.deductionPoints > 0 ? `-${placement.deductionPoints}` : "0",
        input.notes.get(key) ?? "",
      ]);
    }
  }

  return toCsv(headers, rows);
};
