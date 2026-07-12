# Data model

The record is comp-scoped and multi-tenant: many orgs, many comps per org, isolated. Every table carries `comp_id`, or `org_id` where it outlives a single comp.

Two groups of tables follow. The first group exists in Postgres. The second group is designed here and **not migrated**, because no code touches it yet and migrating tables nothing reads is just dead code with a schema. They land with Module A.

---

## Migrated

### Identity and scope

**`orgs`** — `id`, `name`, `slug` (unique), `created_at`

Persists across years. This is the institutional memory that PRD §2.3 says evaporates every May when the board turns over.

**`comps`** — `id`, `org_id`, `name`, `slug`, `comp_date`, `venue`, `status`, `created_at`

`status` ∈ `draft | open | live | complete`, enforced by a check constraint. Unique on `(org_id, slug)`.

**`people`** — `id`, `org_id`, `name`, `email`, `phone`, `created_at`. Unique on `(org_id, email)`.

**`comp_roles`** — `id`, `comp_id`, `person_id`, `role`

`role` ∈ `board | liaison | judge | captain | attendee`. Unique on `(comp_id, person_id, role)`, so a person can be a board member *and* a liaison at the same comp — which is the normal case, not an edge case.

**`board_assignments`** — `id`, `comp_id`, `person_id`, `token_hash` (unique), `revoked_at`, `created_at`

The board's access token, the same primitive judges use, and deliberately **one per board member rather than one per comp**. A lock and an override must name the human who authorized them (PRD B6); a link shared by the whole board can only name the board.

Revoking is a board action against `revoked_at`, but it is *not* the judge's rules ([ADR-0011](decisions/0011-a-board-link-is-revocable-and-a-comp-keeps-one.md)). You cannot revoke your own link, and revoking survives the lock — a judge's link only authorized scoring, while a board link still opens the override and both exports after placements are final. A comp always keeps at least one link that opens, which is what refusing self-revoke buys: the target is never you, so there is always a survivor. Nothing in the product mints a board link, so a revocation is one-way.

### Teams

**`teams`** — `id`, `comp_id`, `name`, `school`, `bid_code`, `status`, `waitlist_rank`, `roster_size`, `division`, `performance_order`, `created_at`

`status` ∈ `applied | waitlisted | accepted | dropped | competing`. Unique on `(comp_id, bid_code)`.

`bid_code` is the anonymized identifier judges see. The status values are the vocabulary of the churn documented in PRD §14: two accepted teams dropped and two waitlisted teams were promoted between the December acceptances doc and the February show, which is precisely why "who has paid" became unanswerable.

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

Unique on `(judge_assignment_id, team_id, criterion_id)`, so a resubmission upserts rather than duplicating. Refused entirely once a `tab_runs` row exists.

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

## Designed, not migrated

### Money

This is the shape of Pain 1 (PRD §2.2), and it is worth getting exactly right before a single dollar moves.

**`fee_schedules`** — `comp_id`, `per_dancer_cents`, `per_room_cents`, `deposit_cents`, `late_fee_cents`, `late_after`

Mayuri 2026 charged $70/dancer + $140/room + a $100 refundable deposit, plus late fees. Every team therefore owes a different total, which is why a lump payment has to be unbundled by hand today.

**`charges`** — `id`, `comp_id`, `team_id`, `kind`, `amount_cents`, `due_at`, `created_at`

`kind` ∈ `registration | hotel | deposit | late_fee`. One row per obligation. Generated from the fee schedule and the team's roster, so nobody computes a total by hand.

**`payments`** — `id`, `comp_id`, `team_id`, `rail`, `gross_cents`, `fee_cents`, `net_cents`, `external_ref`, `received_at`, `reconciled_at`

`rail` ∈ `card | ach | venmo | zelle | check | cash`. Venmo and Zelle are in the enum because they exist in the world, not because we route through them.

**Three columns, not one.** BU Dheem's $100 deposit landed as $97.01. That is `gross_cents = 10000`, `fee_cents = 299`, `net_cents = 9701`. The team's obligation is settled by the gross; the org's bank shows the net; the difference is a recorded cost rather than a $2.99 hole in the books.

**`payment_allocations`** — `id`, `payment_id`, `charge_id`, `amount_cents`

The unbundler. NCSU sent one payment of $2,160 labeled "hotel, security deposit & reg fees." That is one `payments` row and three `payment_allocations` rows. The invariant is `sum(allocations.amount_cents) <= payments.gross_cents`, with the remainder being an unapplied credit.

Without this table you get the kill exhibit from PRD §14: a season-summary sheet reading **$2,837.47** next to a hand-typed note saying *"true amount around 8k."*

**Everything is `integer` cents.** Never a float, never a `numeric` read into a JS `number` for arithmetic. See [ADR-0002](decisions/0002-money-as-cents-and-allocations.md).

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
