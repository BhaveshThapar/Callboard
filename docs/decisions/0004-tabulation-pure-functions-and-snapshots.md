# ADR-0004 — Tabulation is a pure function; locking snapshots its inputs

**Status:** accepted · July 9, 2026

## Context

Today, judges score on paper clipboards. Scores become placements by an unspecified manual process in a deliberation room under a cutoff, and the emcee hand-writes the results into their own script. There is no audit trail. If a team demanded to see the math the next day, the honest answer is that the score sheets are in a folder in someone's apartment, if they weren't recycled (PRD §2.2, §14).

Every comp carries this dispute risk. The trust product is not "nicer forms" — it is being able to answer the question *show me the math* in February, and again in June.

## Decision

**`src/lib/tabulation/` is pure.** It imports nothing from `src/db/`. It reads no clock. It draws no randomness. `tabulate(input, rubric)` returns a byte-identical result for identical arguments, forever.

**Locking writes one `tab_runs` row** holding the frozen `inputs`, the frozen `config` (the rubric), and the `results` the function returned. Reproducing a result is loading that row and calling the function again.

**Corrections never mutate.** A post-lock override inserts a new `tab_runs` row with `supersedes_id` set and a required, attributed `override_reason`.

Two supporting choices, each of which is load-bearing and neither of which is obvious:

**Scores are sorted canonically before summing.** Float addition is not associative and Postgres makes no promise about row order. Without sorting by `(judgeId, teamId, criterionId)`, re-running a snapshot could differ in the last bit and the whole guarantee would be a coin flip that usually lands heads.

**`tab_runs.inputs/config/results` are `json`, not `jsonb`.** `jsonb` reorders object keys and collapses duplicates. A snapshot column must return the bytes that went in.

## Consequences

The reproducibility promise becomes an assertion rather than an aspiration, in three places:

- `reproducibility.test.ts` round-trips a snapshot through JSON exactly as Postgres would, re-runs `tabulate()`, and asserts deep equality — plus bit-for-bit aggregate equality via `Object.is`, and that tampering with one raw score or dropping one deduction changes the result.
- `reproduce()` in `src/lib/comp/tab.ts` runs the same check against a real row.
- The board screen renders **✓ Snapshot reproduces**, live, next to the placements. If it ever reads ✗, the results must not be announced.

The cost is discipline. Any convenience that reaches into the database from inside `tabulation/`, or takes `new Date()` as a default, silently destroys this. That is why it is written in `CLAUDE.md` as an invariant and why the reproducibility test is marked as the one that must never be weakened.

## Rejected

**Computing placements in SQL.** Faster to write, impossible to unit test at this granularity, and it puts the most contested logic in the layer with the fewest tests.

**Storing only the results.** Cheaper, and worthless. A stored answer nobody can re-derive is exactly the folder in someone's apartment, with better fonts.
