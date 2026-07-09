export type NormalizationMethod = "raw" | "zscore" | "rank";

export type Tiebreaker =
  | { kind: "criterion"; criterionId: string }
  | { kind: "head_to_head" }
  | { kind: "highest_single_judge" };

export type Criterion = {
  id: string;
  label: string;
  maxPoints: number;
  /** Basis points. 10000 = 1.0x. Integer so weighting stays deterministic. */
  weightBp: number;
  sortOrder: number;
};

export type Rubric = {
  id: string;
  normalization: NormalizationMethod;
  criteria: Criterion[];
  tiebreakers: Tiebreaker[];
};

export type ScoreInput = {
  judgeId: string;
  teamId: string;
  criterionId: string;
  rawValue: number;
};

export type DeductionInput = {
  teamId: string;
  points: number;
  reason: string;
};

export type TabulationInput = {
  teams: string[];
  judges: string[];
  scores: ScoreInput[];
  deductions: DeductionInput[];
};

export type Placement = {
  teamId: string;
  place: number;
  /** Post-normalization aggregate. Units depend on `method`: points, standard deviations, or negated mean rank. */
  aggregate: number;
  deductionPoints: number;
  judgeCount: number;
  /** Other teams sharing this place. Empty when the team placed cleanly. */
  tiedWith: string[];
  /** Which tiebreaker settled this team's order, if one had to. */
  resolvedBy: Tiebreaker["kind"] | null;
};

export type TabulationResult = {
  method: NormalizationMethod;
  placements: Placement[];
  /** Teams no judge has scored yet. Excluded from `placements` rather than treated as zeroes. */
  unscored: string[];
  /** Ties no configured tiebreaker could settle. The operator must resolve these by hand. */
  unresolvedTies: string[][];
};
