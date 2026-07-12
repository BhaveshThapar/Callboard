# ADR-0011 — a board link is revocable, and a comp always keeps one that opens

**Status:** accepted · July 11, 2026
**Corrects:** [ADR-0007](0007-board-links-are-per-person.md), which claimed board links got revocation "for free". **Closes:** the third deferral in [ADR-0010](0010-a-comp-is-one-division.md).

## Context

ADR-0007 made board links per person so that a lock would have a name on it. In arguing for it, it said:

> `resolveBoardActor` becomes a line-for-line mirror of `resolveJudgeActor`, including the `revoked_at IS NULL` filter. **Board links get revocation for free.**

That was true of the *read* path and false of the *write* path. `board_assignments.revoked_at` was read by `resolveBoardActor`, by the seeder, and by `db:doctor` — and written by nothing at all. `revokeJudgeAction` existed and was wired into the board screen; there was no board equivalent, and no other `UPDATE` anywhere in `src/` touched the column.

So a board link could not be killed from the product, only from the database. A board link is not a small thing to lose: it is bearer access to the lock, the override, the results page, and both CSV exports. Forwarded into a group chat — which ADR-0007 itself named as the expected accident — it stayed live for the life of the comp.

Two documents asserted the opposite. `docs/DATA_MODEL.md` said "revoking works exactly as it does for a judge", and `docs/ARCHITECTURE.md` said "a leaked link can be killed from the board screen". Both were false, and both were written by the change that introduced the gap.

## Decision

**A board link is revocable from the board screen**, by another board member, attributed in `audit_log` as `board.revoke` exactly as `judge.revoke` is.

**A board member cannot revoke their own link**, and this single rule is the entire safety guard. It earns its place twice over:

- *It keeps the comp administrable.* To revoke you must hold a live link, and the target is never you — so there were at least two live links before and there is at least one after. No separate "is this the last link" check is needed, and writing one would be redundant.
- *It keeps the refusal honest.* Nothing in the product mints a board link, so revoking your own is a one-way exit even when the comp survives it. The legitimate case — *my phone was stolen* — is exactly the case where you cannot use your own link anyway, and is served by another board member revoking you.

**Revocation survives the lock, where a judge's does not.** `revokeJudgeAction` refuses after the lock, correctly: a judge's link only ever authorized scoring, and scoring is closed. A board link still authorizes `overrideAction`, `/results`, and both export routes after placements are final — so the moment a leaked board link is *most* worth killing is precisely the moment the judge guard would have refused it. This asymmetry is deliberate and is the one thing here most likely to read as a missing guard.

**The write is one statement, because the invariant cannot survive two.**

```sql
with live as (
  select id from board_assignments
  where comp_id = $1 and revoked_at is null
  order by id for update
)
update board_assignments set revoked_at = now()
 where id = $2 and comp_id = $1 and revoked_at is null
   and (select count(*) from live) >= 2
returning id, person_id
```

Two board members revoking each other at the same instant both pass the application's `refuseRevoke`. Two plain `UPDATE`s would both land, and the comp would be left with nothing that opens — the same shape of hole as the forked run chain in ADR-0010, and worse, because there is no path back.

neon-http has no interactive transactions, but a single statement is still a transaction. `for update` inside the CTE means Postgres cannot inline it: it materializes and takes real row locks on every live board link of the comp, in `id` order, and holds them to the end of the statement. Both racers lock in the same order, so this blocks rather than deadlocks. The loser unblocks, and under READ COMMITTED, EvalPlanQual re-fetches the winner's committed row version and re-applies the qual: `revoked_at is null` now fails, that row drops out of `live`, the count is 1, `>= 2` is false, and the `UPDATE` matches nothing. Exactly one revocation lands. It generalizes to N-way cycles — A→B, B→C, C→A — because it is the *count* that holds the invariant, not the self-check.

### Two alternatives that look right and are not

Both are worth recording, because each is the first thing a reader will reach for.

- **Locking the `comps` row instead** (`with c as (select id from comps where id = $1 for update)`) does not work. Under READ COMMITTED, EvalPlanQual re-checks only the *locked* row. A `count(*)` subquery against `board_assignments` would still run under the statement's original snapshot and would still see two live links, so both revocations land. **The rows you count must be the rows you lock.**
- **A `BEFORE UPDATE` trigger** does not work either. Its count runs under the same stale snapshot, so a naive trigger allows both. Making it take locks deadlocks instead: each transaction already holds its target row by the time the trigger fires, which is the classic ABBA. It would also cost a migration, and this change needs none.

### The honest limit

Unlike `tab_runs_root_unique`, this guarantee lives in an **application statement, not in the schema**. It binds `revokeBoardAction` and nothing else — a hand-run `UPDATE`, or any future writer, is not bound by it. So the code cannot assume it holds, and `db:doctor` gets the detector: a comp with board links but not one that still opens is reported by id, and **reseeding is not offered as the remedy**, because `db:seed` deletes the org and cascades to the comp's scores. Answering "your board is locked out" with "destroy the results" is the demo lying about its own repair. That is the same reasoning as ADR-0010's forked-comp check, applied to a guarantee that is weaker on purpose.

## Consequences

The demo comp now seeds **two** board members. A one-person board cannot demonstrate — or use — the thing that kills a leaked link, since the only link it has is the one you may not revoke. `comp-config.example.json` already shipped two, and ADR-0007 named adding one as a single line of config.

The deployed demo keeps its single board member until its next fresh seed. That is correct: `db:seed` refuses a comp whose links are already in someone's hands, and force-reseeding one mid-prospect to add a board member would be the exact footgun that guard exists to prevent.

`e2e/board-revoke.spec.ts` is the witness, and the falsifiable claim is this: **delete `and (select count(*) from live) >= 2` and the race test produces a comp with zero live board links.** It was run that way. It does. `db:doctor` then reports that comp by id, which is the other half of the check doing its job.

Nothing here enters `TabulationInput`, so no locked snapshot replays differently. `reproducibility.test.ts` is untouched and green.

### What this does not build

**A board link cannot be re-issued.** Revocation is one-way: a board member whose link is killed — including one killed by mistake, or one who asked for it because their phone was stolen — cannot be given a new one from the product, because nothing in the product mints a token. `createToken()` is called only by the seeder.

The remedy is the operator's, and it is *not* `db:seed`: mint a `board_assignments` row against the **existing** comp for a person who already holds its `board` role. Reseeding would delete the org and cascade away the comp's scores.

This is deferred rather than forgotten. A mint path is the thin end of board management, which is Module A and gated on PRD §13 — and the case that most wants it, *"my own link leaked, kill it and give me a new one,"* is the one this design deliberately refuses anyway. The comp itself is never stranded: the invariant guarantees a live board link always remains, so the lock, the override, and the exports stay reachable and stay attributable. Losing your own access is what revocation means.

What ADR-0007 got wrong was not deferring the write path. It was *claiming the thing worked*. Writing the remaining gap down is the correction, not a repetition of it.
