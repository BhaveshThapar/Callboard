# Data model

The record is comp-scoped and multi-tenant: many orgs, many comps per org, isolated. Every table carries `comp_id`, or `org_id` where it outlives a single comp.

Two groups of tables follow. The first group exists in Postgres. The second group is designed here and **not migrated**, because no code touches it yet and migrating tables nothing reads is just dead code with a schema. They land with Module A.

---

## Migrated

### Identity and scope

**`orgs`** — `id`, `name`, `slug` (unique), `created_at`

Persists across years. This is the institutional memory that PRD §2.3 says evaporates every May when the board turns over.

**`comps`** — `id`, `org_id`, `name`, `slug`, `comp_date`, `venue`, `status`, `registration`, `created_at`

`status` ∈ `draft | open | live | complete`, enforced by a check constraint. Unique on `(org_id, slug)`.

`registration` is the public form, authored as data in the comp config exactly like the rubric — waiver text, `requireAuditionUrl`, `maxRosterSize`, and `fields`, the board's own questions. Null, or a `status` other than `open`, and there is no form to fill in; `openRegistration` collapses those two cases into one answer, because distinguishing them publicly would leak the existence of a comp that has not announced itself.

`registration.fields` is both the form and the schema its answers are validated against, which is what keeps one definition of what a comp asked. Each field carries an `id`, a `label`, a type (`text | longtext | number | select | checkbox`), and whether it is required. The `id` is the key answers are stored under and is the one thing a board must not change once applications start arriving — renaming it orphans every answer already filed. The `label` is what the applicant reads and is safe to reword at any time; keeping the two separate is the whole reason the id is stated rather than derived.

**`people`** — `id`, `org_id`, `name`, `email`, `phone`, `created_at`. Unique on `(org_id, email)`.

**`comp_roles`** — `id`, `comp_id`, `person_id`, `role`

`role` ∈ `board | liaison | judge | captain | attendee`. Unique on `(comp_id, person_id, role)`, so a person can be a board member *and* a liaison at the same comp — which is the normal case, not an edge case.

**`board_assignments`** — `id`, `comp_id`, `person_id`, `token_hash` (unique), `revoked_at`, `created_at`

The board's access token, the same primitive judges use, and deliberately **one per board member rather than one per comp**. A lock and an override must name the human who authorized them (PRD B6); a link shared by the whole board can only name the board. Revoking works exactly as it does for a judge.

### Teams

**`teams`** — `id`, `comp_id`, `name`, `school`, `bid_code`, `status`, `waitlist_rank`, `roster_size`, `division`, `performance_order`, `contact_person_id`, `audition_url`, `waiver_accepted_at`, `custom_answers`, `created_at`

`status` ∈ `applied | waitlisted | accepted | dropped | competing`. Unique on `(comp_id, bid_code)` — the name `teams_comp_bid_code_unique` has one definition, in `src/db/schema/teams.ts`, because `apply` has to name it: `nextBidCode` is a read-then-insert and neon-http has no transactions, so two applications landing together collide, and the loser retries rather than failing.

`bid_code` is the anonymized identifier judges see. The status values are the vocabulary of the churn documented in PRD §14: two accepted teams dropped and two waitlisted teams were promoted between the December acceptances doc and the February show, which is precisely why "who has paid" became unanswerable.

The last three columns are what an application *said*, and they are the evidence a board accepts or rejects a team on: `contact_person_id` (the captain — `people` is per-org, so a captain across two comps is one person; `on delete set null`), `audition_url` (which a comp may *require*), and `waiver_accepted_at` — a timestamp rather than a boolean, because a boolean records a claim and a timestamp records an event, and this is the column a board would be asked to produce if anything ever went wrong. All three are null for a seeded team, which never applied. `listRosterForBoard` is the only window that selects them, and it is the only one that may: a judge's projection of a team never carries a name, let alone a captain's email.

`custom_answers` is the fourth, and it holds the answers to whatever the comp added to its own form, keyed by `registration.fields[].id`. `json` rather than `jsonb`, for `tab_runs`' reason: jsonb reorders keys and collapses duplicates, and what a team submitted should come back as what it submitted. A column rather than a table because an answer has no life of its own — never queried across teams, never updated, and dead when the team is. It is meaningless without the questions in `comps.registration`, which is the only thing that can say what was asked, and is why the board screen reads the labels from there rather than from the keys.

`waitlist_rank` is assigned by `setTeamStatus` when a team joins the waitlist: the end of the queue, `max + 1` over the comp's ranked waitlisted teams. Arrival order is the only order a board never has to state, and it is the one they assume is running. Before this it was read by `nextOffWaitlist` and written by nothing but the seed config, which meant every team a board waitlisted through the roster screen was unranked — so id order was not the *fallback* order but the only one, and ids are uuids.

It is **not renumbered** when a team is promoted or dropped, so a live list has gaps in it and appending goes past the maximum rather than the count.

A board **reorders** through `setWaitlistRank`, which is a *trade*: two adjacent teams exchange ranks, leaving the set of numbers on the comp exactly as it was, so every team outside the pair keeps the number the board has already seen — gaps included. Arrival order is the order a board assumes; it is not always the order it wants, and before this the only instrument for saying so was to drop teams and re-waitlist them in the desired order, which writes drops into the audit log that never happened and is unavailable after a lock. Two teams cannot trade what one of them does not have, so a pair sharing a rank, or one with no rank at all, falls through to a re-space — the only path that renumbers, and it moves as little as the ordering allows.

The reorder writes many rows and still does not open a transaction. Its invariant does not span statements: the rewrites are applied as a single `case` expression, and one statement is atomic on neon-http without asking for anything ([ADR-0012](decisions/0012-transactions-for-writes-that-span-statements.md) stays about writes that genuinely span two). A rank is roster, so the lock freezes it — the arrows are hidden after a lock and refused by the server regardless.

Neither write is in a transaction, so two board members working the roster at the same moment can leave two teams sharing a rank — appending against the same maximum, or one half of a trade skipped because its team was promoted out of the `where` in between. `nextOffWaitlist` breaks that tie by id, which is the old behavior applied to one pair instead of the whole list, and a second click resolves it. A `unique(comp_id, waitlist_rank)` would turn the tie into a refusal, and a board told "could not waitlist that team" because a colleague clicked first is worse than two teams sharing rank 4.

### Scoring

**`rubrics`** — `id`, `comp_id`, `name`, `normalization`, `tiebreakers` (jsonb), `created_at`

`normalization` ∈ `raw | zscore | rank`. `tiebreakers` is an ordered array, applied in order. Rubrics are data: fusion weights choreography and execution; classical uses different criteria entirely.

**`rubric_criteria`** — `id`, `rubric_id`, `label`, `max_points`, `weight_bp`, `sort_order`

`weight_bp` is basis points; `10000` = 1.0×. An integer, so weighting never introduces float drift into the scoring pipeline.

**`judge_assignments`** — `id`, `comp_id`, `person_id`, `label_seq`, `token_hash` (unique), `revoked_at`, `created_at`

The raw token exists only in the URL handed to the judge. Revoking is a write, not a password reset.

`label_seq` is the "Judge 2" the board sees beside a score, persisted rather than derived ([ADR-0008](decisions/0008-judge-scores-are-de-identified.md)).

There is deliberately **no `division`**: a comp is one division ([ADR-0010](decisions/0010-a-comp-is-one-division.md)), so a judge's division is the comp's. The column that used to be here read like an authorization key — *which teams may this judge see* — and authorized nothing, because `listTeamsForJudge` scopes by comp and status and always did.

**`scores`** — `id`, `comp_id`, `judge_assignment_id`, `team_id`, `criterion_id`, `raw_value`, `submitted_at`

Unique on `(judge_assignment_id, team_id, criterion_id)`, so a resubmission upserts rather than duplicating.

Once a `tab_runs` row exists, a score is refused — **by the application, not by the database.** The distinction is the whole point and must not be smoothed over: there is no constraint here that could refuse it, so a judge who lost the race with the lock button, or a hand-typed `INSERT`, can still land a `scores` row after the lock. That row enters **no run, ever** — the first lock froze its inputs, and an override replays that frozen snapshot rather than re-reading the tables. It is therefore invisible to every result, which is exactly the state that must not be silent. `scoresOutsideChain` is what counts those rows and says so on the board screen, and `e2e/late-score.spec.ts` is what holds it. Read this line as "the database enforces it" and that counter looks like dead code.

**`judge_notes`** — `id`, `comp_id`, `judge_assignment_id`, `team_id`, `note`, `submitted_at`

A judge's written feedback for one team, unique on `(judge_assignment_id, team_id)`. A table rather than a column on `scores`, because a note is one per *team* and a score is one per *criterion*.

Notes never reach `TabulationInput` and nothing under `src/lib/tabulation/` knows they exist. A note carries no number and moves no placement, so it stays out of the frozen snapshot — a locked result must reproduce from the scores alone. The feedback export is therefore the one place frozen and live data are read together, which is safe because notes close when scoring closes.

**`deductions`** — `id`, `comp_id`, `team_id`, `points`, `reason`, `created_by_person_id`, `created_at`

Recorded against the team, not against a judge: a time penalty is an objective fact about the performance, not one judge's opinion. `reason` is `not null` on purpose.

Deductions are also the only lever a **correction** has. Scores are immutable after a lock, so a post-lock correction is expressed as an attributed deduction plus a re-tabulation.

**`tab_runs`** — `id`, `seq`, `comp_id`, `rubric_id`, `inputs`, `config`, `results`, `locked_at`, `locked_by_person_id`, `supersedes_id`, `override_reason`

The locked snapshot. `inputs` and `config` are the frozen arguments to `tabulate()`; `results` is what it returned. Re-running the function against `inputs` must reproduce `results` exactly — that is the whole of the dispute-proofing claim.

These three columns are **`json`, not `jsonb`**. `jsonb` reorders object keys and collapses duplicates, so it cannot promise a snapshot comes back as the bytes that went in.

A comp's runs are **one chain: one root, one head**, held by two partial unique indexes ([ADR-0010](decisions/0010-a-comp-is-one-division.md)). `tab_runs_root_unique` (`comp_id where supersedes_id is null`) refuses a second first-lock; `tab_runs_supersedes_unique` refuses two runs superseding the same parent. `lockResults` checks before it inserts, but neon-http has no transactions, so the check and the insert are two acts — the database is the only thing that can actually refuse a fork, and a forked chain is two frozen, attributed, reproducible results with nothing to say which one stands.

A correction never mutates. It inserts a new row with `supersedes_id` set and an `override_reason` written by a human.

`seq` is a generated identity, and it is what orders the runs. `locked_at` cannot: it defaults to `now()`, the transaction timestamp, so two runs can share one. `id` cannot either — it is a random v4. `seq` is never shown to a board, because it does not reset when a comp is reseeded; the board is told a per-comp run number instead.

A partial unique index on `supersedes_id` (where it is not null) means **two runs can never supersede the same parent**. A forked chain has two heads and no fact of the matter about which result stands, and a double-submitted correction is the realistic way that happens. The database refuses it rather than the application.

**`audit_log`** — `id`, `comp_id`, `actor_kind`, `actor_person_id`, `action`, `entity`, `entity_id`, `before`, `after`, `at`

Append-only, indexed on `(comp_id, at)`. `actor_kind` ∈ `board | judge | system`. Every score submission, deduction, lock, and override lands here.

---

## Money

This is the shape of Pain 1 (PRD §2.2), and it is worth getting exactly right before a single dollar moves. **Landing in migration `0009`** — the columns below are what implementation settled on, and where they exceed [ADR-0002](decisions/0002-money-as-cents-and-allocations.md)'s sketch the reason is given, because the next reader takes this section as the spec.

Five constraints do the real work and are named once, in `MONEY_CONSTRAINTS`, for `CHAIN_INDEXES`' reason — the schema, the write path reading a failed insert's `cause`, and `db:doctor` must agree on strings none can derive. What each refuses is [ADR-0014](decisions/0014-the-allocation-counter.md).

**`fee_schedules`** — `id`, `comp_id`, `per_dancer_cents`, `per_room_cents`, `deposit_cents`, `late_fee_cents`, `late_after`

Mayuri 2026 charged $70/dancer + $140/room + a $100 refundable deposit, plus late fees. Every team therefore owes a different total, which is why a lump payment has to be unbundled by hand today.

`id` was not in ADR-0002's list and is added for the ordinary reason — a row a `charges` generation run can name. The schedule is authored as comp config, not in a UI: it arrives from a treasurer through [INTAKE.md](INTAKE.md), which asks for exactly these five numbers.

`per_room_cents` bills per room, and nothing recorded a room count — so **`teams.rooms integer`** is added, nullable. Null means *not yet known*, and the generator must emit **no hotel charge plus a stated gap** rather than a $0 one. A $0 hotel charge is a lie a treasurer will believe, and will find in April.

**`charges`** — `id`, `comp_id`, `team_id`, `kind`, `amount_cents`, `due_at`, `created_at`, `voided_at`, `voided_reason`

`kind` ∈ `registration | hotel | deposit | late_fee`. One row per obligation. Generated from the fee schedule and the team's roster, so nobody computes a total by hand.

**`voided_at`, never `DELETE`.** Deleting a charge that has money against it destroys the record of what a payment was *for*. Voiding gets the hard case right: a team that paid $1,120 and then dropped reads `owed 0 / paid 1120 / balance −1120` — the org owes them, stated in the product rather than discovered in April. `charges_live_kind_unique` is partial on `voided_at is null`, which is what makes regeneration idempotent — one live obligation per `(team, kind)` — while leaving voided history in place. It is also why a team that paid, dropped and came back reads *paid, not owing*: the old allocations still count, and the void does not block the new charge.

**`amount_cents > 0`, never negative.** A revision is a void plus an insert. Two mechanisms for "owes less than we said" is one too many, and the negative one is what makes a `sum()` report quietly wrong.

**`payments`** — `id`, `comp_id`, `team_id`, `rail`, `gross_cents`, `fee_cents`, `net_cents`, `allocated_cents`, `external_ref`, `received_at`, `reconciled_at`

`rail` ∈ `card | ach | venmo | zelle | check | cash`. Venmo and Zelle are in the enum because they exist in the world, not because we route through them — and today none of them is routed, so **every payment row is hand-entered**. That is the design, not a stopgap: it is what lets the ledger close the gap without Stripe.

**Three columns, not one.** BU Dheem's $100 deposit landed as $97.01. That is `gross_cents = 10000`, `fee_cents = 299`, `net_cents = 9701`. The team's obligation is settled by the gross; the org's bank shows the net; the difference is a recorded cost rather than a $2.99 hole in the books.

`net = gross - fee` is a **`CHECK`, not a generated column**. A generated column *supplies* the right answer, so an import claiming `net 9701` where the arithmetic says `9702` lands cleanly and the disagreement disappears. The ~$5,000 gap is made of discrepancies nobody was shown, so this one is refused at the door.

`external_ref` is unique where present: a replayed webhook or a re-imported CSV is a duplicate payment, and a duplicate payment is a team told it is paid up when it is not.

**`payment_allocations`** — `id`, `payment_id`, `charge_id`, `amount_cents`, `voided_at`

The unbundler. NCSU sent one payment of $2,160 labeled "hotel, security deposit & reg fees." That is one `payments` row and three `payment_allocations` rows. The invariant is `sum(allocations.amount_cents) <= payments.gross_cents`, with the remainder being an unapplied credit.

**`payments.allocated_cents` is what enforces that**, and it is the one denormalized number in the schema. The invariant spans rows, so a `CHECK` cannot see it; `CHECK (allocated_cents <= gross_cents)` plus `UPDATE ... SET allocated_cents = allocated_cents + $n` can, because that statement is one atomic read-modify-write holding its own row lock. Over-allocation becomes unrepresentable rather than merely caught. The residual — the database enforces `allocated <= gross`, *not* `allocated = sum(live allocations)` — is why `db:doctor` reports drifting payments by id. All of this is [ADR-0014](decisions/0014-the-allocation-counter.md), including why it is not a trigger.

Without this table you get the kill exhibit from PRD §14: a season-summary sheet reading **$2,837.47** next to a hand-typed note saying *"true amount around 8k."*

**Everything is `integer` cents.** Never a float, never a `numeric` read into a JS `number` for arithmetic. See [ADR-0002](decisions/0002-money-as-cents-and-allocations.md).

---

## Designed, not migrated

### Schedule

The Gita, per PRD §9. Modeled now, built after paying customers exist.

**`show_order`** — `comp_id`, `team_id`, `position`. The single input, drawn Friday night. Everything else is derived.

**`schedule_segments`** — `id`, `comp_id`, `team_id`, `kind`, `starts_at`, `ends_at`, `derived_from`

`kind` ∈ `walk | lobby | stretch | props | tech_in | tech_out | food | judge_cutoff | transport`. `derived_from` records which buffer variable produced the timing, so a live delay can re-derive the cascade instead of a human doing it by mouth.

**`assignments`** — `id`, `comp_id`, `person_id`, `duty`, `starts_at`, `ends_at`, `swa_trained`

Replaces the ~30 hand-compiled per-person columns of the SATURDAY IND sheet.

---

## Permissions

Role-based row and field filtering is a first-class primitive, not an afterthought (PRD §8.1). Today it lives in `src/lib/auth/scope.ts`, where a judge's projection of `teams` does not select `name` and the return type says so.

Postgres RLS is the eventual hardening. It is not built. [ADR-0006](decisions/0006-tenancy-app-layer-scoping-rls-later.md) says when to revisit.
