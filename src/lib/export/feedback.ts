import { toCsv } from "./csv";

/**
 * What a team receives. Note what is absent: there is no score anywhere in this type. A team is
 * told where it placed, what it was docked and why, and what each judge wrote — and nothing else.
 *
 * Publishing the numbers invites a team to litigate a 27-vs-28 on Execution, which is an argument
 * no board can win and no rubric can settle. The board can still prove the placement is right, from
 * the locked snapshot; that is a different question from handing over the score sheet.
 *
 * `scoredBy` carries which (judge, team) pairs were scored but not what was scored, so this builder
 * cannot emit a raw value even by mistake: it never holds one.
 */
export type TeamFeedbackInput = {
  /** From the frozen `tab_runs.results`. */
  placements: readonly { teamId: string; place: number; deductionPoints: number }[];
  /** From the frozen `tab_runs.inputs`. teamId -> every reason recorded against it. */
  deductionReasons: ReadonlyMap<string, readonly string[]>;
  teams: ReadonlyMap<string, { name: string; bidCode: string }>;
  /** judge_assignment id -> "Judge 2", in panel order. Never a name. */
  judges: ReadonlyMap<string, string>;
  /** `judgeId:teamId` keys the judge scored. Membership only — deliberately carries no values. */
  scoredBy: ReadonlySet<string>;
  /** Keyed `judgeId:teamId`. Read live, because notes are deliberately not in the snapshot. */
  notes: ReadonlyMap<string, string>;
};

export const noteKey = (judgeId: string, teamId: string): string => `${judgeId}:${teamId}`;

/**
 * One row per (team, judge): what that judge wrote. Judges appear in panel order — the insertion
 * order of `judges`, which is `label_seq` — and not sorted by label text, which would file Judge 10
 * ahead of Judge 2.
 *
 * A judge who neither scored nor wrote gets no row. One who scored but wrote nothing gets a row
 * with an empty note, so a team can see that all three judges did judge it.
 */
export const toTeamFeedbackCsv = (input: TeamFeedbackInput): string => {
  const headers = [
    "Place",
    "Team",
    "Bid code",
    "Team deduction",
    "Deduction reason",
    "Judge",
    "Note",
  ];

  const rows: string[][] = [];
  for (const placement of [...input.placements].sort((a, b) => a.place - b.place)) {
    const team = input.teams.get(placement.teamId);
    const reasons = input.deductionReasons.get(placement.teamId) ?? [];

    for (const [judgeId, label] of input.judges) {
      const key = noteKey(judgeId, placement.teamId);
      const note = input.notes.get(key);
      if (!input.scoredBy.has(key) && note === undefined) continue;

      rows.push([
        String(placement.place),
        team?.name ?? placement.teamId,
        team?.bidCode ?? "",
        placement.deductionPoints > 0 ? `-${placement.deductionPoints}` : "0",
        reasons.join("; "),
        label,
        note ?? "",
      ]);
    }
  }

  return toCsv(headers, rows);
};
