# Data model

The record is comp-scoped and multi-tenant: many orgs, many comps per org, isolated. Most tables carry `comp_id`, or `org_id` where they outlive a single comp.

**That sentence said *every* table until August 15, 2026, and it was not true.** `orgs` is the tenancy root and needs no key, and **four carry neither**: `rubric_criteria`, `payment_allocations`, `sessions` and `message_events`. Each reaches its scope through exactly one join — to `rubrics`, `payments`, `users` and `messages` respectively — which is fine while scoping is app-layer and is precisely what P3 has to answer for, because a row-level-security policy cannot be written against a column that is not there. Overstating it mattered for one reason: P3's design was being planned against the claim rather than against the schema.

Two groups of tables follow. The first group exists in Postgres, through migration `0017` — `0014` adds A4's materials columns to `teams`, `0015` adds `drive_connections` for A11, `0016` drops `comp_roles`, and `0017` adds `assignments` and `comps.duties` for C1. The second group is designed here and **not migrated**, because no code touches it yet and migrating tables nothing reads is just dead code with a schema.

It used to say those land "with Module A". They do not, and the sentence outlived its own truth: Module A landed in `0009`–`0011`, and what is left in that group is `schedule_segments` — the Gita (PRD §9). `assignments` left it with C1 in `0017` and is described under *Coordination* below; `show_order` left it with G1 in `0018` by **not being built at all** ([ADR-0023](decisions/0023-the-draw-is-a-column-not-a-table.md)).

---

## Migrated

### Identity and scope

**`orgs`** — `id`, `name`, `slug` (unique), `created_at`

Persists across years. This is the institutional memory that PRD §2.3 says evaporates every May when the board turns over.

**`comps`** — `id`, `org_id`, `name`, `slug`, `comp_date`, `venue`, `status`, `registration`, `duties`, `created_at`

`status` ∈ `draft | open | live | complete`, enforced by a check constraint and by `COMP_STATUSES` in `src/db/schema/orgs.ts`, which is the one definition the type, the constraint, the config parser and the board's own control all derive from.

It is what gates the public form, and it is **written by the board**, forward only, through `src/lib/comp/lifecycle.ts` — a total transition map in `transitions.ts`' shape. Until August 2, 2026 the only writer was `src/db/seed.ts`, so a board that opened registration could not close it: the sole remaining instrument was a reseed, which replaces the comp and reissues every token ([ADR-0013](decisions/0013-a-seed-replaces-a-comp-not-an-org.md)) — closing a form meant destroying the comp. Nothing runs backwards, because an application landing against a comp whose roster is being scored is the state the lock exists to make impossible.

`registration` is the public form, authored as data in the comp config exactly like the rubric — waiver text, `requireAuditionUrl`, `maxRosterSize`, and `fields`, the board's own questions. Null, or a `status` other than `open`, and there is no form to fill in; `openRegistration` collapses those two cases into one answer, because distinguishing them publicly would leak the existence of a comp that has not announced itself.

`duties` is C1's vocabulary, authored the same way and for the same reason (`0017`). PRD §7.3 specifies coordination in one line and names no duties, so the list is a board's to state — the fee schedule's precedent, where a list that does not fit is a signal about the design rather than a bug in the parser. Each entry carries an `id` (the key an `assignments` row stores, under the same never-rename rule as a field id, and validated by the same regex), a `label`, a `category` from the four in `DUTY_CATEGORIES`, and whether it needs SWA training. Null and `[]` are collapsed to the same fact.

`registration.fields` is both the form and the schema its answers are validated against, which is what keeps one definition of what a comp asked. Each field carries an `id`, a `label`, a type (`text | longtext | number | select | checkbox`), and whether it is required. The `id` is the key answers are stored under and is the one thing a board must not change once applications start arriving — renaming it orphans every answer already filed. The `label` is what the applicant reads and is safe to reword at any time; keeping the two separate is the whole reason the id is stated rather than derived.

**`people`** — `id`, `org_id`, `name`, `email`, `phone`, `created_at`. Unique on `(org_id, email)`.

**`comp_roles`** — **dropped in `0016`, with C1.** It described participation (`board | liaison | judge | captain | attendee`), was written only by the seed, and never had a reader. Its own schema comment set the condition — *"if it is still readerless when the coordination work is actually scheduled, it should be dropped then"* — and coordination is C1. It was kept on the stated grounds that it was "the shape C1 needs (person ↔ duty ↔ comp)" and that the seed wrote it "so that the record of who was involved survives the links being revoked". **Both were false.** It had no `duty` column and no time columns, so it could express neither *what* nor *when*; and `board_assignments` and `judge_assignments` are revoked rather than deleted, so that record survived without it. `assignments` below is what C1 actually needed.

**`board_assignments`** — `id`, `comp_id`, `person_id`, `token_hash` (unique), `revoked_at`, `created_at`

The board's access token, the same primitive judges use, and deliberately **one per board member rather than one per comp**. A lock and an override must name the human who authorized them (PRD B6); a link shared by the whole board can only name the board. Revoking works exactly as it does for a judge.

### Accounts

Migrated in `0012` ([ADR-0016](decisions/0016-accounts-for-people-who-stay-links-for-people-who-visit.md)). **Accounts for people who stay, links for people who visit** — a judge deliberately still has none, because a judge scores once as a favour and an account is friction charged to a volunteer. Board members and captains sign in.

The whole set exists to answer one question in two halves: *which human is this*, and *what may they do at this comp*. Keeping those two lookups apart is what stops a session at one comp becoming authority at the next.

**`users`** — `id`, `org_id`, `person_id`, `email`, `password_hash`, `email_verified_at`, `last_login_at`, `disabled_at`, `created_at`. Unique on `(org_id, email)`, plus a CHECK that `email` is already lower-cased.

Login is **org-scoped**, not global, and hangs off `people` so that a board member who is also a captain is one human rather than two. `password_hash` is scrypt from `node:crypto`, stored as `scrypt$N$r$p$salt$hash` — the algorithm and its cost are *data*, so raising the cost is a rehash on next login rather than a flag day. Not argon2: it is a native module in Node, and this repo has five runtime dependencies.

**`memberships`** — `id`, `comp_id`, `person_id`, `role`, `team_id`, `revoked_at`, `created_at`. Unique on `(comp_id, person_id, role)`.

`role` ∈ `board | captain | liaison`, from `ACCOUNT_ROLES` — what a session is allowed to resolve to. It used to define itself against `comp_roles.role`, which said what a person *was* at a comp; that table is gone, so this is now the only list of who is at a comp in what capacity. A CHECK enforces that `team_id` is set exactly when `role = 'captain'` — a captain with no team could see nothing, and a liaison with a team would imply a claim nothing reads.

`revoked_at` is the only way somebody comes back off a comp, and it is read by every membership filter, so a revoked membership stops resolving on the next request. The session is left alone on purpose: killing it would sign that person out of comps this board has no say over.

**What can be handed out and what can be held are equal again, and stayed two lists.** `INVITABLE_ROLES` was `board | captain` from P1 until C1: `liaison` was a real role with a real actor and **no reader**, because *what does a liaison see* is C1's question, and offering it let a board mint a credential whose journey ended on a page that refused to load — the failure [ADR-0011](decisions/0011-nothing-mints-a-link.md) spent a decision refusing, arriving through the door ADR-0016 opened. C1 gave it a screen and the role went back on the list in that commit, which is the rule the constant carried. They remain two constants for `BILLABLE_STATUSES`' reason: they answer *what may be issued* and *what may be held*, and the day a fourth role is representable before it is issuable, one moves and the other must not.

**`sessions`** — `id`, `user_id`, `token_hash` (unique), `expires_at`, `revoked_at`, `user_agent`, `created_at`

A row, **not a JWT**. The token gets exactly the treatment ADR-0003 gave a judge link: 32 random bytes in the cookie, sha256 in the database, the raw value never stored. A stateless session cannot be revoked, and revocability is the property ADR-0011 spent an entire decision on — so a leaked session has to be killable from a screen, which means it has to be a row.

**`invitations`** — `id`, `org_id`, `comp_id`, `person_id`, `purpose`, `role`, `team_id`, `token_hash` (unique), `expires_at`, `accepted_at`, `revoked_at`, `created_by_person_id`, `created_at`

The minting path ADR-0011 refused and named its own successor for. An invitation **names who it is for before it is accepted**, so accepting one cannot make you somebody else. `invitations_live_unique` is partial over the unspent rows, so a re-invite supersedes rather than leaving two valid envelopes in the world.

`purpose` ∈ `invite | verify_email | reset_password`. Only `invite` is written today; the other two are the shapes a password reset and an email confirmation will take, and both need a delivery channel that does not exist yet.

Accepting is the fourth sanctioned `withTransaction` caller ([ADR-0012](decisions/0012-transactions-for-writes-that-span-statements.md)): an invitation is spent exactly when the authority it grants exists, and either half alone is a state a human has to find — an envelope marked used that granted nothing, or a membership with no account behind it.

`ACCOUNT_CONSTRAINTS` names all five indexes once, for `CHAIN_INDEXES`' and `MONEY_CONSTRAINTS`' reason: the schema declares them, the auth paths read one off a failed insert to say something true to a person, and `db:doctor` looks them up to prove the guarantee is live on the database in front of it.

### Teams

**`teams`** — `id`, `comp_id`, `name`, `school`, `bid_code`, `status`, `waitlist_rank`, `roster_size`, `division`, `performance_order`, `contact_person_id`, `audition_url`, `waiver_accepted_at`, `custom_answers`, `music_url`, `emergency_contact_name`, `emergency_contact_phone`, `materials_submitted_at`, `roster_size_requested`, `created_at`

`status` ∈ `applied | waitlisted | accepted | dropped | competing`. Unique on `(comp_id, bid_code)` — the name `teams_comp_bid_code_unique` has one definition, in `src/db/schema/teams.ts`, because `apply` has to name it: `nextBidCode` is a read-then-insert and neon-http has no transactions, so two applications landing together collide, and the loser retries rather than failing.

`bid_code` is the anonymized identifier judges see. The status values are the vocabulary of the churn documented in PRD §14: two accepted teams dropped and two waitlisted teams were promoted between the December acceptances doc and the February show, which is precisely why "who has paid" became unanswerable.

The last three columns are what an application *said*, and they are the evidence a board accepts or rejects a team on: `contact_person_id` (the captain — `people` is per-org, so a captain across two comps is one person; `on delete set null`), `audition_url` (which a comp may *require*), and `waiver_accepted_at` — a timestamp rather than a boolean, because a boolean records a claim and a timestamp records an event, and this is the column a board would be asked to produce if anything ever went wrong. All three are null for a seeded team, which never applied. `listRosterForBoard` is the only window that selects them, and it is the only one that may: a judge's projection of a team never carries a name, let alone a captain's email.

The last five are A4's **materials half** — what a team files *after* it is accepted, as opposed to what it applied with. `music_url` is a link rather than a file, following `audition_url`'s own precedent: there is nowhere in this system to put a file, and a board asking for final music gets a Drive link because that is what boards actually exchange. Every write passes through one `putMaterial` seam that parses the URL and admits only `http`/`https`, because this is the one string a captain writes that a board member later clicks — so a blob store arriving later is an implementation of that seam rather than a migration. `materials_submitted_at` is a timestamp for `waiver_accepted_at`'s reason, and null is the fact a board chases: *never filed*.

`roster_size_requested` is the one that carries a rule. `roster_size` is what `planCharges` bills on, so a captain who could write it could edit their own invoice — downward, and with nobody told. So a captain writes a **claim** here and `setTeamBilling` is the only thing that turns it into money, clearing the claim in the same statement that states the roster: *state it, bill it, close the request* is one act, which is why A4 adds no `withTransaction` caller and no fourth window. It is the *a `teamId` on a form is a claim* rule applied one level up — to the number instead of the id. Refused once results are locked, because `teams` lives inside `tab_runs.inputs`; the other four are not, and comp day is exactly when somebody needs an emergency number.

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

Append-only, indexed on `(comp_id, at)`. `actor_kind` ∈ `board | judge | team | liaison | system` — P1 added the last two with accounts in `0012`, and this line said three until August 15, 2026. `ACTOR_KINDS` in `src/db/schema/audit.ts` is the one definition and `audit_log_actor_kind_check` derives from it, so a sixth kind is a migration rather than a type edit. Every score submission, deduction, lock, and override lands here.

---

## Money

This is the shape of Pain 1 (PRD §2.2), and it is worth getting exactly right before a single dollar moves. **Landing in migration `0009`** — the columns below are what implementation settled on, and where they exceed [ADR-0002](decisions/0002-money-as-cents-and-allocations.md)'s sketch the reason is given, because the next reader takes this section as the spec.

Five constraints do the real work and are named once, in `MONEY_CONSTRAINTS`, for `CHAIN_INDEXES`' reason — the schema, the write path reading a failed insert's `cause`, and `db:doctor` must agree on strings none can derive. What each refuses is [ADR-0014](decisions/0014-the-allocation-counter.md).

**`fee_schedules`** — `id`, `comp_id`, `per_dancer_cents`, `per_room_cents`, `deposit_cents`, `late_fee_cents`, `late_after`

Mayuri 2026 charged $70/dancer + $140/room + a $100 refundable deposit, plus late fees. Every team therefore owes a different total, which is why a lump payment has to be unbundled by hand today.

`id` was not in ADR-0002's list and is added for the ordinary reason — a row a `charges` generation run can name. The schedule is authored as comp config, not in a UI: it arrives from a treasurer through [INTAKE.md](INTAKE.md), which asks for exactly these five numbers.

`per_room_cents` bills per room, and nothing recorded a room count — so **`teams.rooms integer`** is added, nullable. Null means *not yet known*, and the generator must emit **no hotel charge plus a stated gap** rather than a $0 one. A $0 hotel charge is a lie a treasurer will believe, and will find in April.

**Something has to be able to write it, and for three weeks nothing could.** `rooms` shipped with exactly one writer — the seed script — so the gap was correct, honest and *permanent*: every team that registered through the product read "hotel: not billed — room count unknown" forever, and a comp charging $140 a room could not charge one of them. Two paths write it now. The public form asks for it when, and only when, `per_room_cents > 0` — derived rather than declared twice, so the question and the charge cannot disagree — and the board states or corrects it on the roster screen beside `roster_size`, which re-bills in the same transaction. A blank field stays null on both paths: `Number("")` is 0, and a stated zero is a team saying it needs no rooms.

**`charges`** — `id`, `comp_id`, `team_id`, `kind`, `amount_cents`, `due_at`, `created_at`, `voided_at`, `voided_reason`

`kind` ∈ `registration | hotel | deposit | late_fee`. One row per obligation. Generated from the fee schedule and the team's roster, so nobody computes a total by hand.

**`voided_at`, never `DELETE`.** Deleting a charge that has money against it destroys the record of what a payment was *for*. Voiding gets the hard case right: a team that paid $1,120 and then dropped reads `owed 0 / paid 1120 / balance −1120` — the org owes them, stated in the product rather than discovered in April. `charges_live_kind_unique` is partial on `voided_at is null`, which is what makes regeneration idempotent — one live obligation per `(team, kind)` — while leaving voided history in place. It is also why a team that paid, dropped and came back reads *paid, not owing*: the old allocations still count, and the void does not block the new charge.

**`amount_cents > 0`, never negative.** A revision is a void plus an insert. Two mechanisms for "owes less than we said" is one too many, and the negative one is what makes a `sum()` report quietly wrong.

**`payments`** — `id`, `comp_id`, `team_id`, `rail`, `gross_cents`, `fee_cents`, `net_cents`, `allocated_cents`, `external_ref`, `received_at`, `reconciled_at`

`rail` ∈ `card | ach | venmo | zelle | check | cash`. Venmo and Zelle are in the enum because they exist in the world, not because we route through them — and today none of them is routed, so **every payment row is hand-entered**. That is the design, not a stopgap: it is what lets the ledger close the gap without Stripe.

**Three columns, not one.** BU Dheem's $100 deposit landed as $97.01. That is `gross_cents = 10000`, `fee_cents = 299`, `net_cents = 9701`. The team's obligation is settled by the gross; the org's bank shows the net; the difference is a recorded cost rather than a $2.99 hole in the books.

`net = gross - fee` is a **`CHECK`, not a generated column**. A generated column *supplies* the right answer, so an import claiming `net 9701` where the arithmetic says `9702` lands cleanly and the disagreement disappears. The ~$5,000 gap is made of discrepancies nobody was shown, so this one is refused at the door.

`external_ref` is unique where present: a replayed webhook or a re-imported CSV is a duplicate payment, and a duplicate payment is a team told it is paid up when it is not.

`reconciled_at` is the mark a treasurer makes having matched a row against the bank, and it is a **timestamp rather than a boolean** for `waiver_accepted_at`'s reason: a boolean records a claim, a timestamp records an event. It shipped in this migration with no writer at all, which left PRD §13's *reconciliation error vs. bank: $0* as a metric with no instrument — the rows could be exported and matched by eye, and there was nowhere to record that they had been, so every pass through a season started from nothing. Unlike a `deposit_events` ending it is **reversible**: a reconciliation mark moves no money, and a mis-tick you cannot undo makes the mark worth less rather than more. Every flip is audited, which is where the history lives; `payments` is not an append-only chain and does not become one for this.

**`payment_allocations`** — `id`, `payment_id`, `charge_id`, `amount_cents`, `voided_at`

The unbundler. NCSU sent one payment of $2,160 labeled "hotel, security deposit & reg fees." That is one `payments` row and three `payment_allocations` rows. The invariant is `sum(allocations.amount_cents) <= payments.gross_cents`, with the remainder being an unapplied credit.

**`payments.allocated_cents` is what enforces that**, and it is the one denormalized number in the schema. The invariant spans rows, so a `CHECK` cannot see it; `CHECK (allocated_cents <= gross_cents)` plus `UPDATE ... SET allocated_cents = allocated_cents + $n` can, because that statement is one atomic read-modify-write holding its own row lock. Over-allocation becomes unrepresentable rather than merely caught. The residual — the database enforces `allocated <= gross`, *not* `allocated = sum(live allocations)` — is why `db:doctor` reports drifting payments by id. All of this is [ADR-0014](decisions/0014-the-allocation-counter.md), including why it is not a trigger.

Without this table you get the kill exhibit from PRD §14: a season-summary sheet reading **$2,837.47** next to a hand-typed note saying *"true amount around 8k."*

**`deposit_events`** — `id`, `seq`, `comp_id`, `charge_id`, `state`, `reason`, `created_by_person_id`, `created_at`

`state` ∈ `held | refund_pending | refunded | forfeited | refund_failed`. What happened to a refundable deposit, one row per transition — the `tab_runs` chain applied to a smaller question. Nothing is ever updated: current state is `max(seq)`'s row, and the history is the rows themselves rather than something reconstructed from the audit log.

**A refund is not a negative payment.** `payments_gross_check` forbids one deliberately: a negative gross makes `allocated_cents <= gross_cents` uninterpretable, and that ceiling is the single thing [ADR-0014](decisions/0014-the-allocation-counter.md) bought with a denormalized column.

`deposit_events_terminal_unique` is partial over `('refunded','forfeited')` and refuses a **second ending**. A double-clicked refund button is the realistic way a deposit is returned twice, and the check and the insert are two acts on neon-http — so the index is what refuses it, not a transaction. `refund_failed` is deliberately **not** terminal: a bounced ACH return is retryable, and calling it an ending would strand the money in a state the product cannot leave.

**Everything is `integer` cents.** Never a float, never a `numeric` read into a JS `number` for arithmetic. See [ADR-0002](decisions/0002-money-as-cents-and-allocations.md).

---

## Comms

Migrated in `0013` ([ADR-0020](decisions/0020-a-message-sends-once.md)). The first thing this product built that **acts on the outside world**: every write before it was a row a board could correct — a voided charge, a released allocation, a superseded run — and a sent email cannot be voided. There is no `revoked_at` on somebody's inbox.

So the hard question here is not *is this number right*, it is *did this happen exactly once* — and the second is worse, because a duplicate is invisible from inside the system. Two identical rows and one row look the same on every screen; the difference shows up on a captain's phone at 11pm.

**`messages`** — `id`, `comp_id`, `person_id`, `channel`, `kind`, `template`, `payload`, `dedupe_key`, `state`, `send_after`, `attempts`, `provider_ref`, `created_by_person_id`, `created_at`

The outbox, one row per intended message. **`messages_comp_dedupe_unique` on `(comp_id, dedupe_key)` is the whole guarantee** — a caller does not ask whether it already sent, it inserts and reads the refusal, because the ask and the insert would be two acts on neon-http and only one of them is atomic. The key is the caller's sentence about what this message *is* (`dues:2027-02`), never a digest of the body: a digest would make a reworded reminder a different message and send it again, which is the bug.

`payload` is `json`, not `jsonb`, for `tab_runs.inputs`' reason — the bytes that went in are what a person was actually shown. One field is the exception and it is declared as one: the raw invitation link is stripped when the message reaches `sent` ([ADR-0021](decisions/0021-the-outbox-holds-a-secret-only-until-it-sends.md)), because emailing a credential means holding it and holding it forever is a different decision from holding it for five minutes.

`kind` ∈ `transactional | broadcast`, and **suppression is decided by kind, never by recipient**: `people.unsubscribed_at` bounces a broadcast and does not touch a bill, because a debt is owed whether or not somebody wants to hear from the board. The opt-out link rides on the broadcast payload so the visible line in the body and the `List-Unsubscribe` header are the same string.

`state` is denormalized and **is the claim** — ADR-0014's bargain repeated for a different reason. The counter was denormalized because a cross-row sum cannot be a CHECK; this is, because a chain cannot be claimed atomically. So the claim is one guarded `UPDATE ... WHERE state IN ('queued','failed')`, `releaseAllocation`'s shape, and a worker that gets no row back sends nothing.

**`message_events`** — `id`, `message_id`, `seq generatedAlwaysAsIdentity`, `state`, `detail`, `created_at`

The chain, `deposit_events` applied to a smaller question: one row per transition, state is `max(seq)`'s row. `queued → sending → sent | failed | bounced`. `message_events_terminal_unique` is partial over the endings, so a second one is unrepresentable. **`failed` is not terminal** and `bounced` is, for `refund_failed`'s reason — a timed-out connection is retryable, a rejected address is not, and only the transport knows which it saw.

The residual is ADR-0014's again and gets the same instrument: the database cannot enforce that `state` agrees with `max(seq)`, so `db:doctor` reports the disagreement by id. A message stuck in `sending` is reported too and **never auto-retried** — that is exactly the crash-after-send footprint, and retrying it emails somebody twice.

---

## Designed, not migrated

### Schedule

The Gita, per PRD §9. Modeled now, built after paying customers exist.

**`show_order`** — **not built, and it will not be** ([ADR-0023](decisions/0023-the-draw-is-a-column-not-a-table.md)). It was designed here as `comp_id`, `team_id`, `position`, which is `teams.performance_order` with extra steps: that column has existed since `0000`, both scoring windows already ordered by it, and it had no writer in the product at all. G1 gave it the writer it was missing rather than a second place to disagree about which team dances third. `0018` adds `teams_comp_performance_order_unique`, and it is `DEFERRABLE INITIALLY DEFERRED` — a reorder is a *trade* of two adjacent positions in one `UPDATE`, and a non-deferred unique refuses that halfway through. Probed on `dev` rather than assumed; the partial unique index this started as failed on the first swap.

This is `comp_roles`' lesson a second time, arriving from the other direction. There, a designed table was dropped because it was not the shape the feature needed. Here, a designed table is never created because a column already **was** it. Same rule: a designed table earns its migration when the code reaches it, and what the code reaches for is allowed to differ from what the design guessed.

**`schedule_segments`** — `id`, `comp_id`, `team_id`, `kind`, `starts_at`, `ends_at`, `derived_from`

`kind` ∈ `walk | lobby | stretch | props | tech_in | tech_out | food | judge_cutoff | transport`. `derived_from` records which buffer variable produced the timing, so a live delay can re-derive the cascade instead of a human doing it by mouth.

---

## Coordination

Migrated in `0017`, with C1. `comp_roles` was dropped in `0016` in the same phase — see above.

**`assignments`** — `id`, `comp_id`, `person_id`, `duty_id`, `category`, `team_id`, `starts_at`, `ends_at`, `note`, `swa_trained_at`, `acknowledged_at`, `completed_at`, `created_by_person_id`, `created_at`, `revoked_at`

Person ↔ duty ↔ time. Replaces the ~30 hand-compiled per-person columns of the SATURDAY IND sheet.

`duty_id` keys into `comps.duties` rather than a table, for `custom_answers`' reason: the config is both the vocabulary and the labels it is read under, so there is one definition of what a comp asked somebody to do and it survives to be read a year later. `category` ∈ `team | judge | hospitality | general`, denormalized off that config because a CHECK and the Gita's timing derivations both need it in SQL. **Four categories, each named for its reader** — a category nothing reads is `judge_assignments.division` again.

**Three timestamps, not booleans.** `swa_trained_at` is the board's mark; `acknowledged_at` and `completed_at` are the liaison's, and the only two writes a liaison makes in this product. DATA_MODEL designed this as `swa_trained boolean` and was wrong for `waiver_accepted_at`'s and `reconciled_at`'s reason: a boolean records a claim and a timestamp records an event, and *when was this person trained* is the question a board has to answer.

`revoked_at`, never `DELETE`: deleting a duty somebody already acknowledged destroys the record that they were told to be at the door at four, which is the record a board needs on the day nobody was.

Two partial unique indexes rather than one, and the split is forced. Postgres treats NULLs as distinct, so a single unique over `(comp, person, duty, team)` would constrain team duties and silently let two identical `general` duties stack on one person. `assignments_live_unique` covers `team_id is not null` and `assignments_live_no_team_unique` the rest; `assignments_team_check` has already made that split equivalent to `category = 'team'`, so it is one rule expressed twice by necessity rather than two that could drift. `db:doctor` looks both up.

`person_id` is a **bare FK**, exactly as `scores.team_id` is, so the database will take an assignment naming somebody at another comp. Every write resolves it against a scoped read first.

---

## Permissions

Role-based row and field filtering is a first-class primitive, not an afterthought (PRD §8.1). Today it lives in `src/lib/auth/scope.ts`, where a judge's projection of `teams` does not select `name` and the return type says so.

Postgres RLS is the eventual hardening. It is not built. [ADR-0006](decisions/0006-tenancy-app-layer-scoping-rls-later.md) says when to revisit.
