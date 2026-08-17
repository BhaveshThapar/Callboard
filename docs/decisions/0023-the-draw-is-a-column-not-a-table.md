# ADR-0023 — The draw is a column, not a table

**Status:** accepted · August 17, 2026 · *implemented (G1, migration `0018`)*

## Context

[DATA_MODEL.md](../DATA_MODEL.md) designed the Gita's first table before any of it was built:

> **`show_order`** — `comp_id`, `team_id`, `position`. The single input, drawn Friday night. Everything else is derived.

That design predates the product. By the time G1 was actually built, `teams.performance_order` already existed — an `integer`, nullable, on the roster of record since migration `0000`. It was **read** by both scoring windows (`listTeamsForJudge` and `listTeamsForBoard` order by it, and the judge's card prints `Performance {n}`), and it was **written by nothing in the product**: only `src/db/seed.ts` set it, off the comp config, defaulting to `i + 1`.

So the choice was not *build a table or not*. It was: build a second definition of the running order, or give the existing one the writer it never had.

## Decision

**`show_order` is not built. `teams.performance_order` is the one definition of the running order**, and G1 is the write path it was missing.

This is [C1's own move](0013-a-seed-replaces-a-comp-not-an-org.md) applied a second time. `comp_roles` was dropped rather than used because the table being kept for the feature was not the shape the feature needed; here the table being kept for the feature is the shape it needed, and **a column already was it**. Both are the same rule: a designed table earns its migration when the code reaches it, not before, and what the code reaches for is allowed to be different from what the design guessed.

Three things follow.

**The draw is roster, so it resolves against the roster window.** `RosterTeamView` already carries `performanceOrder`, so *which team dances third* asks no new question about which teams count — A3's argument, one column over. `setShowOrder` and `moveInShowOrder` are the eighth and ninth writes resolving against `listRosterForBoard`, and there is **no fourth window**.

**It freezes at the lock.** `teams` lives inside `tab_runs.inputs` and `performance_order` is on `teams`, so a redraw after a lock would describe a comp the locked result does not. Both writes refuse once a run exists, `setWaitlistRank`'s rule.

**Who is in the draw is its own question.** `PERFORMING_STATUSES` is a fourth list equal to `SCOREABLE_STATUSES`, `BILLABLE_STATUSES` and `ANNOUNCEABLE_STATUSES`, and equal to them is not the same as an alias of them. PRD §9 G6 names filler acts and exhibition padding as engineered slack: an exhibition set occupies a slot, is walked by a liaison, is pushed to a phone — and is not placed. The day a comp enters one, this list and `SCOREABLE_STATUSES` come apart, and a shared constant would put an exhibition team in the placements. That is [ADR-0009](0009-teams-is-the-roster-of-record.md)'s bug through a new door.

## The constraint has to be deferrable, and that was measured

`teams_comp_performance_order_unique` is `UNIQUE (comp_id, performance_order) DEFERRABLE INITIALLY DEFERRED`.

Moving one act up the running order is a **trade**: two teams exchange positions in a single `UPDATE`. Postgres checks a non-deferred unique as each row is written, so that statement transiently holds two teams at position 4. The first version of this was a partial unique index, and it was refused on the first swap:

```
duplicate key value violates unique constraint "swap_probe_unique"
```

Probed on the `dev` branch rather than reasoned about, because the alternative was finding it on a board's screen. Three properties were checked and all three hold with the deferrable form: the swap is allowed, a **genuine** duplicate is still refused, and the whole undrawn roster coexists because `NULL` means *not drawn yet* and Postgres treats NULLs as distinct.

Deferred to *commit*, and `db` has no transactions ([ADR-0012](0012-transactions-for-writes-that-span-statements.md)) — every statement is its own implicit transaction, so the check lands at the end of the one `UPDATE`. **That is what keeps the sanctioned `withTransaction` callers at four.** *These two rows exchange positions* is an invariant spanning two **rows**, not two statements, and a constraint is the right instrument for it. A fifth transaction caller would have been the wrong reading of ADR-0012.

Drizzle cannot express deferrability, so the schema declares a plain `unique()` and the migration hand-writes the clause. That split is stable rather than merely tolerated: drizzle does not model the property, so it never appears in a diff and `db:generate` will not try to take it back. `db:doctor` verifies the constraint by name, for `CHAIN_INDEXES`' reason — the guarantee lives in the database, so the code cannot assume it is there.

## Consequences

**`docs/DATA_MODEL.md`'s Schedule group loses one of its two tables.** What is left designed-and-not-migrated there is `schedule_segments`, and it is argued separately: a derived schedule is a snapshot, not a second source of truth.

**A gap in the running order is legal and closing it is a board's act.** When a team drops, its slot is not reclaimed automatically — the numbers stay as printed, and `setShowOrder` renumbers `1..N` when the board asks. The alternative, silently renumbering on every drop, changes what an emcee's sheet says without anybody deciding to.

**No randomness, here or ever.** Callboard ingests the show-order result the mixer game produces; it does not run the game ([ROADMAP.md](../ROADMAP.md)'s one exception to the tarpit). `src/lib/schedule/` is fenced against `Math.random()`, so this is enforced rather than promised.

**The numbers this feeds are still a guess.** No founding partner has sent a Gita ([INTAKE.md](../INTAKE.md) Part 3, "Not yet"). The draw is the one part of the schedule that is *not* a guess — a position is a position — which is why it was worth building first.
