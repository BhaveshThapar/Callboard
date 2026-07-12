# ADR-0010 — a comp is one division; the run chain has one root

**Status:** accepted · July 11, 2026
**Related:** [ADR-0009](0009-teams-is-the-roster-of-record.md), which is the same mistake in a different column — and [ADR-0004](0004-tabulation-pure-functions-and-snapshots.md), whose one-snapshot-per-lock claim the second half of this restores.

## Context

Two holes, found while asking what was left to build after judging. Both are in the shipped demo, and both produce a locked, attributed, reproducible result that is wrong.

### 1. Divisions were solicited, validated, stored, and never read

`teams.division` and `judge_assignments.division` existed. `parseCompConfig` validated both. `seed.ts` wrote both. And no read path anywhere honored either:

- `listTeamsForJudge` scoped by `comp_id` and status, never by division — so **every judge saw every team**, and a fusion judge scored the classical roster.
- `getRubric` returned the comp's *first* rubric by `createdAt` — so per-division score sheets silently collapsed into one.
- `buildTabulationInput` built one input for the whole comp — so **every division was ranked in a single list**, and a classical team placed above a fusion team.

The column that made this dangerous is the judge's. `judge_assignments.division` reads exactly like an authorization key — *which teams may this judge see* — and authorized nothing.

What makes it worse than a missing feature is that [`docs/INTAKE.md`](../INTAKE.md), the page written to be forwarded to a treasurer, **asked for it**: *"Division, if you run divisions."* So the sequence was: ask a founding partner for a divisional roster, accept it without complaint, seed it, and then show them a demo that scores their comp wrong — on the call where the whole point is to be trusted.

ADR-0009's bug was latent, because nothing sets a team's status yet. This one was not. The parser accepted a two-division config the day it was written.

### 2. The run chain could fork at the root

`tab_runs_supersedes_unique` is partial — `WHERE supersedes_id IS NOT NULL`. It refuses two runs superseding the same parent, and by construction cannot say anything about the **first** lock, whose `supersedes_id` is null.

`lockResults` reads `latestLockedRun` and then inserts. neon-http has no transactions, so those are two acts. Two board members clicking Lock at the same moment — the most crowded moment of comp night — both read "not locked yet", and both insert a root.

The comp then holds two unsuperseded runs: two frozen, attributed, reproducible results, each of which passes an audit on its own, with **nothing to say which one stands**. `latestLockedRun` orders by `seq` and shows one as though the other were not there.

This is not theoretical. Dropping the index and running `e2e/lock-race.spec.ts` produces two roots on the first attempt.

## Decision

**A comp is one division.** One rubric, one judge pool, one ranked list. A board running two divisions gets two comps — which is what they are, since placements are per-division.

- `parseCompConfig` refuses a config declaring more than one named division, in either the roster or the panel, and says why. It is the only door, so it is where the refusal belongs.
- `judge_assignments.division` is **dropped**. A judge is assigned to a comp, and the comp is the division.
- `teams.division` is **kept**. It describes a roster; it does not authorize anything. That is the whole distinction: *delete the field that lied about authorization, keep the one that only describes.*

**A comp's runs are one chain: one root, and one head.** `tab_runs_root_unique` — unique on `comp_id WHERE supersedes_id IS NULL` — sits beside the existing index, and the two together make the chain unforkable from either end. The application's pre-check stays, because it produces a better message; the database is what makes the guarantee.

## Consequences

A single uniform division stays legal, and the demo still carries one (`"fusion"`). It is a label. Only a *second* name is a second competition. An unlabelled row beside a labelled one is a missing label, not a division, and is accepted — refusing it would reject the demo's own roster and prevent nothing.

A board running divisions now needs one config, one seed, and one board link per division, and cannot see both divisions on one screen. That is a real cost, and it is the honest one: there was never a screen that could show two divisions correctly, only one that showed them wrongly.

**The migration will fail loudly on any comp that has already forked**, because a unique index cannot be built over two existing roots. That is the correct behavior — a comp with two roots needs a human to decide which result stood — but it means the migration is not unconditionally safe to apply to a database that has been running without it.

Drizzle wraps driver errors, so the thrown error's `message` is the failed `INSERT` statement; the constraint name lives on its `cause`. A board member who lost a lock race must be told *"another board member locked these results first"* — the first draft of this fix read the wrong message and would have shown them `Failed query: insert into "tab_runs" ...` at the moment placements went final.

Nothing here enters `TabulationInput`, so no locked snapshot replays differently. `reproducibility.test.ts` is untouched and green.
