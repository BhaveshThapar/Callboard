# ADR-0009 — `teams` is the roster of record; a score is only evidence about it

**Status:** accepted · July 11, 2026
**Related:** [ADR-0004](0004-tabulation-pure-functions-and-snapshots.md), which made a locked result reproducible. This one is about the difference between reproducible and correct — and [ADR-0006](0006-tenancy-app-layer-scoping-rls-later.md), whose app-layer scoping this closes a hole in.

## Context

`TabulationInput` carries both `teams` and `scores`, and nothing made them agree.

`buildTabulationInput` filtered **teams** by status (`accepted`, `competing`) but loaded **scores** on `comp_id` alone. Placements are driven by the aggregates, and the aggregates are built from the scores — `rankTeams` ranks whatever keys it finds there, never consulting `input.teams`. So a team's scores outlived its place in the comp:

```
Teams the comp says are competing: team-a, team-b

Placements actually produced:
  1. team-dropped   ← not a competing team
  2. team-a
  3. team-b
```

A withdrawn team did not merely appear in the results. It **won**, and pushed every team that did compete down a place.

Two things fed it, and the second is the one that made it exploitable rather than merely latent:

- **The definition of "which teams count" was written twice** — once in `src/lib/auth/scope.ts` and again in `src/lib/comp/tab.ts` — so the query that loaded the roster and the query that loaded the scores could drift, and did.
- **The write paths never scoped `teamId`.** `submitScores`, `submitNote`, and the board's deduction path all took `teamId` straight off the form. `scores.team_id` is a bare FK to `teams.id` with nothing tying it to `comp_id`, so the database would accept a score naming *another comp's* team — and the tabulator would rank it. The board's feedback route already checked this (*"No such team in this comp."*); the scoring path, which is the one that decides placements, did not.

Nothing mutates team status today — `seed.ts` hardcodes `competing` and there is no `update(teams)` in the repo — so this could not fire in the shipped demo. It arms itself the moment Module A lands, because A2 *is* the accept/waitlist/promote/drop workflow. PRD §14 records it happening: two accepted teams dropped and two waitlisted teams were promoted between the December acceptances and the February show.

The failure this produces is the worst one available to this product. The lock would freeze a wrong result, `reproduce()` would confirm it reproduces, and the audit trail would name the person who locked it. Every guarantee the system makes would hold, and the placements would still be wrong. **Reproducible is not correct, and an audit trail that faithfully records a lie is worse than none — because the whole thing being sold is that you can trust it the next day.**

## Decision

**`teams` is the roster of record. `scores` is evidence about it. A score naming a team not on the roster is ignored.**

Enforced in three places, deliberately overlapping:

1. **`tabulate()` filters `scores` and `deductions` to `input.teams` before ranking.** This is the load-bearing one, and it is *not* redundant with (2) — do not delete it as such. It makes the function total: it holds its contract for any input it is handed, including a snapshot replayed from `tab_runs` a year from now, written by a version of the loader that had the bug.
2. **`buildTabulationInput` joins scores and deductions to `teams`**, filtered on both `comp_id` and scoreable status, so the malformed shape never forms.
3. **The write paths check `teamId` against the scoped read** (`listTeamsForJudge` / `listTeamsForBoard`) that produced the form in the first place.

And `SCOREABLE_STATUSES` now has one definition, in `src/db/schema/teams.ts`, because it decides two things that must agree: which teams a judge may score, and which teams the tabulator ranks. Those were the two that drifted.

## Consequences

A dropped team keeps its scores in the table — they are not deleted, because nothing here is deleted — and simply stops placing. It is not reported as `unscored` either: it is not in the comp at all.

`tabulate()` now does work that is provably unnecessary given (2), on every call. It is a set membership test per score, against panels of tens, and reproducibility is worth more than the nanoseconds.

Locked runs written before this change are unaffected: `reproducibility.test.ts` still passes, because a snapshot only replays differently if it already contained a score for a team not on its own roster — and none does.

The tabulator will now silently ignore a score it cannot attribute to a competing team. That is the right default for *placing*, but it means a score can be cast into a void. Today the write paths reject those at the door, so the filter should never have anything to do. If a future path can create one, it should be surfaced rather than swallowed.
