# Tabulation

Everything here is implemented in `src/lib/tabulation/`, which imports nothing from the database, reads no clock, and draws no randomness. `tabulate(input, rubric)` is a deterministic function.

## Pipeline

```
scores + deductions
  → weighted totals, per judge, per team     (aggregate.ts)
  → one aggregate per team                   (normalize.ts)
  → placements, ties resolved or surfaced    (rank.ts)
```

### 1. Weighted totals

For each judge and team, sum `raw_value × weight_bp / 10000` across the criteria on the rubric. Scores for criteria that are not on the rubric are ignored rather than trusted.

Scores are sorted by `(judgeId, teamId, criterionId)` before summing. Float addition is not associative, and Postgres makes no promise about row order — without a canonical order, re-running a locked snapshot could differ in the last bit and the reproducibility guarantee would be a coin flip.

### 2. Deductions

**Deductions are subtracted from every judge's total for that team, before normalization.**

This is the one place the implementation departs from an obvious-sounding design. The intuitive rule is "apply the penalty to the final score," and for `raw` that is exactly what happens — the mean is affine, so subtracting `d` from each judge's total is provably identical to subtracting `d` from the team's mean. There is a test asserting it.

But for `zscore` and `rank`, the final aggregate is measured in **standard deviations** or **rank positions**, not points. Subtracting 2 points from a z-score of 0.86 is a category error. Applying the penalty upstream, where the units are still points, is the only well-defined choice, and it means the penalty flows through the same transform as everything else.

The visible consequence: under `zscore`, a deduction slightly moves the penalized judge's mean and spread. That is correct. The team is ranked on the performance it actually delivered, penalty included.

### 3. Normalization

Three methods, configured per rubric. **Higher is always better**, including for `rank`, where the negated mean rank is returned so one ordering convention holds across all three.

**`raw`** — the team's aggregate is the mean of its judges' weighted totals.

**`zscore`** — for each judge, across the teams *that judge scored*:

```
z = (total − judgeMean) / judgeStdev        (population stdev, divide by n)
```

then the team's aggregate is the mean of its z-scores. This is what lets a harsh judge and a lenient judge disagree about scale while agreeing about order, and have both count equally. Buckeye Mela and others compute this by hand today (PRD §8.3 B3).

A judge who scored every team identically has zero spread. They contribute **0**, not `NaN`. Same for a judge who scored exactly one team.

**`rank`** — each judge orders the teams they scored; the team's aggregate is the negated mean of its ranks. Teams a judge scored equally share the average of the positions they occupy (fractional ranks), so the ranks one judge hands out always sum to `n(n+1)/2`.

Use `rank` when judges' scales are wildly nonlinear and only their ordering can be trusted.

### 4. Placement and ties

Teams are sorted by aggregate, descending. Two aggregates within `1e-9` are treated as tied rather than separated by float noise.

Tied groups are then handed to the rubric's ordered `tiebreakers` list. Each tiebreaker maps a team to a number, higher wins:

| Tiebreaker | Key |
|---|---|
| `criterion` | The team's mean raw value on a designated criterion |
| `head_to_head` | Copeland score within the tied group: +1 for each rival more judges preferred, −1 for each rival they didn't |
| `highest_single_judge` | The team's best single-judge total |

A tiebreaker that fails to separate the group is skipped and the next one is tried. The tiebreaker that first reduces a team's group to one is recorded on the placement as `resolvedBy`, and the board shows it — *"won on head to head."*

**A tie that survives every configured tiebreaker is never silently broken.** The tied teams share a place, `unresolvedTies` names them, and the board renders a red banner telling the operator to resolve it by hand before announcing. Places use standard competition ranking: two teams tied at 1 means the next team is 3.

Display order within an unresolved tie is by team id, so the screen is deterministic even though the result is not decided.

## Locking

Locking writes one `tab_runs` row holding the frozen `inputs`, the frozen `config`, and the `results`. Reproducing a result means loading that row and calling `tabulate()` again:

```ts
const { matches } = reproduce(run);   // src/lib/comp/tab.ts
```

The board displays this live: **✓ Snapshot reproduces**. If it ever reads ✗, the results must not be announced.

Locking closes scoring. A correction after the lock does not edit anything — it inserts a new `tab_runs` row with `supersedes_id` and a required, attributed `override_reason`.

Because scores are immutable after the lock, a correction changes the result the only way it can: it records an attributed `deductions` row and re-tabulates. The prior run keeps its own frozen `inputs`, which still hold the deductions as they stood when *it* was locked, and still reproduce. A partial unique index on `supersedes_id` prevents two runs from superseding the same parent, so the chain cannot fork.

## What is not in the snapshot

`judge_notes` — a judge's written feedback for one team — never enters `TabulationInput`, and nothing under `src/lib/tabulation/` knows the table exists. A note carries no number and moves no placement, so a locked result must reproduce from the scores alone.

The feedback export therefore reads frozen and live data together: scores, criteria, and placements from `tab_runs`; notes from `judge_notes`. That is safe because notes are refused after the lock, exactly as scores are, so the two are fixed at the same moment.

## Rounding

Never mid-pipeline. Aggregates are carried at full double precision through normalization, ranking, and into the stored snapshot. Rounding happens once, in the UI: three decimals for `raw` and `zscore`, two for mean rank.

## Tests

`src/lib/tabulation/__tests__/` — 35 tests, and they are the reason to trust any of the above.

- `normalize.test.ts` — hand-computed z-scores, the zero-spread guard, fractional ranks, basis-point weighting.
- `rank.test.ts` — each tiebreaker, fall-through when one cannot discriminate, place skipping, unresolved ties surfacing, determinism under input reordering.
- `tabulate.test.ts` — the affine-equivalence proof for `raw` deductions, deductions under `zscore` and `rank`, unscored teams excluded rather than zeroed.
- `reproducibility.test.ts` — **the one that must never be weakened.** Round-trips a snapshot through JSON exactly as Postgres would, re-runs `tabulate()`, and asserts deep equality; asserts bit-for-bit aggregate equality via `Object.is`; asserts that tampering with a single raw score or dropping a deduction changes the result.

If `reproducibility.test.ts` fails, the audit trail is a lie and PRD §13's "100% next-day reproducibility" is unmet.
