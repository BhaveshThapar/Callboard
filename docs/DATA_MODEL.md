# Data model

The record is comp-scoped and multi-tenant: many orgs, many comps per org, isolated. Every table carries `comp_id`, or `org_id` where it outlives a single comp.

Two groups of tables follow. The first group exists in Postgres, through migration `0013`. The second group is designed here and **not migrated**, because no code touches it yet and migrating tables nothing reads is just dead code with a schema.

It used to say those land "with Module A". They do not, and the sentence outlived its own truth: Module A landed in `0009`–`0011`, and what is left in that group is `show_order`, `schedule_segments` and `assignments` — the Gita (PRD §9) and coordination (§7.3), both gated well behind it.

---

## Migrated

### Identity and scope

**`orgs`** — `id`, `name`, `slug` (unique), `created_at`

Persists across years. This is the institutional memory that PRD §2.3 says evaporates every May when the board turns over.

**`comps`** — `id`, `org_id`, `name`, `slug`, `comp_date`, `venue`, `status`, `registration`, `created_at`

`status` ∈ `draft | open | live | complete`, enforced by a check constraint and by `COMP_STATUSES` in `src/db/schema/orgs.ts`, which is the one definition the type, the constraint, the config parser and the board's own control all derive from.

It is what gates the public form, and it is **written by the board**, forward only, through `src/lib/comp/lifecycle.ts` — a total transition map in `transitions.ts`' shape. Until August 2, 2026 the only writer was `src/db/seed.ts`, so a board that opened registration could not close it: the sole remaining instrument was a reseed, which replaces the comp and reissues every token ([ADR-0013](decisions/0013-a-seed-replaces-a-comp-not-an-org.md)) — closing a form meant destroying the comp. Nothing runs backwards, because an application landing against a comp whose roster is being scored is the state the lock exists to make impossible.

`registration` is the public form, authored as data in the comp config exactly like the rubric — waiver text, `requireAuditionUrl`, `maxRosterSize`, and `fields`, the board's own questions. Null, or a `status` other than `open`, and there is no form to fill in; `openRegistration` collapses those two cases into one answer, because distinguishing them publicly would leak the existence of a comp that has not announced itself.

`registration.fields` is both the form and the schema its answers are validated against, which is what keeps one definition of what a comp asked. Each field carries an `id`, a `label`, a type (`text | longtext | number | select | checkbox`), and whether it is required. The `id` is the key answers are stored under and is the one thing a board must not change once applications start arriving — renaming it orphans every answer already filed. The `label` is what the applicant reads and is safe to reword at any time; keeping the two separate is the whole reason the id is stated rather than derived.

**`people`** — `id`, `org_id`, `name`, `email`, `phone`, `created_at`. Unique on `(org_id, email)`.

**`comp_roles`** — `id`, `comp_id`, `person_id`, `role`

`role` ∈ `board | liaison | judge | captain | attendee`. Unique on `(comp_id, person_id, role)`, so a person can be a board member *and* a liaison at the same comp — which is the normal case, not an edge case.

**`board_assignments`** — `id`, `comp_id`, `person_id`, `token_hash` (unique), `revoked_at`, `created_at`

The board's access token, the same primitive judges use, and deliberately **one per board member rather than one per comp**. A lock and an override must name the human who authorized them (PRD B6); a link shared by the whole board can only name the board. Revoking works exactly as it does for a judge.

### Accounts

Migrated in `0012` ([ADR-0016](decisions/0016-accounts-for-people-who-stay-links-for-people-who-visit.md)). **Accounts for people who stay, links for people who visit** — a judge deliberately still has none, because a judge scores once as a favour and an account is friction charged to a volunteer. Board members and captains sign in.

The whole set exists to answer one question in two halves: *which human is this*, and *what may they do at this comp*. Keeping those two lookups apart is what stops a session at one comp becoming authority at the next.

**`users`** — `id`, `org_id`, `person_id`, `email`, `password_hash`, `email_verified_at`, `last_login_at`, `disabled_at`, `created_at`. Unique on `(org_id, email)`, plus a CHECK that `email` is already lower-cased.

Login is **org-scoped**, not global, and hangs off `people` so that a board member who is also a captain is one human rather than two. `password_hash` is scrypt from `node:crypto`, stored as `scrypt$N$r$p$salt$hash` — the algorithm and its cost are *data*, so raising the cost is a rehash on next login rather than a flag day. Not argon2: it is a native module in Node, and this repo has five runtime dependencies.

**`memberships`** — `id`, `comp_id`, `person_id`, `role`, `team_id`, `revoked_at`, `created_at`. Unique on `(comp_id, person_id, role)`.

`role` ∈ `board | captain | liaison`, from `ACCOUNT_ROLES`. Deliberately **not** `comp_roles.role`: that column says what a person *is* at a comp (including `attendee`, who will never have an account), and this says what a session is allowed to resolve to. Two questions, two lists. A CHECK enforces that `team_id` is set exactly when `role = 'captain'` — a captain with no team could see nothing, and a liaison with a team would imply a claim nothing reads.

`revoked_at` is the only way somebody comes back off a comp, and it is read by every membership filter, so a revoked membership stops resolving on the next request. The session is left alone on purpose: killing it would sign that person out of comps this board has no say over.

**What can be *handed out* is narrower than what can be held.** `INVITABLE_ROLES` is `board | captain`; `liaison` is a real role with a real actor and **no reader**, because *what does a liaison see* is C1's question and C1 needs `assignments`, which is in the designed-not-migrated group below. Offering it let a board mint a credential whose journey ended on a page that refused to load — the failure [ADR-0011](decisions/0011-nothing-mints-a-link.md) spent a decision refusing, arriving through the door ADR-0016 opened. It goes back on the list in the same commit that gives it a screen.

**`sessions`** — `id`, `user_id`, `token_hash` (unique), `expires_at`, `revoked_at`, `user_agent`, `created_at`

A row, **not a JWT**. The token gets exactly the treatment ADR-0003 gave a judge link: 32 random bytes in the cookie, sha256 in the database, the raw value never stored. A stateless session cannot be revoked, and revocability is the property ADR-0011 spent an entire decision on — so a leaked session has to be killable from a screen, which means it has to be a row.

**`invitations`** — `id`, `org_id`, `comp_id`, `person_id`, `purpose`, `role`, `team_id`, `token_hash` (unique), `expires_at`, `accepted_at`, `revoked_at`, `created_by_person_id`, `created_at`

The minting path ADR-0011 refused and named its own successor for. An invitation **names who it is for before it is accepted**, so accepting one cannot make you somebody else. `invitations_live_unique` is partial over the unspent rows, so a re-invite supersedes rather than leaving two valid envelopes in the world.

`purpose` ∈ `invite | verify_email | reset_password`. Only `invite` is written today; the other two are the shapes a password reset and an email confirmation will take, and both need a delivery channel that does not exist yet.

Accepting is the fourth sanctioned `withTransaction` caller ([ADR-0012](decisions/0012-transactions-for-writes-that-span-statements.md)): an invitation is spent exactly when the authority it grants exists, and either half alone is a state a human has to find — an envelope marked used that granted nothing, or a membership with no account behind it.

`ACCOUNT_CONSTRAINTS` names all five indexes once, for `CHAIN_INDEXES`' and `MONEY_CONSTRAINTS`' reason: the schema declares them, the auth paths read one off a failed insert to say something true to a person, and `db:doctor` looks them up to prove the guarantee is live on the database in front of it.

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

**`show_order`** — `comp_id`, `team_id`, `position`. The single input, drawn Friday night. Everything else is derived.

**`schedule_segments`** — `id`, `comp_id`, `team_id`, `kind`, `starts_at`, `ends_at`, `derived_from`

`kind` ∈ `walk | lobby | stretch | props | tech_in | tech_out | food | judge_cutoff | transport`. `derived_from` records which buffer variable produced the timing, so a live delay can re-derive the cascade instead of a human doing it by mouth.

**`assignments`** — `id`, `comp_id`, `person_id`, `duty`, `starts_at`, `ends_at`, `swa_trained`

Replaces the ~30 hand-compiled per-person columns of the SATURDAY IND sheet.

---

## Permissions

Role-based row and field filtering is a first-class primitive, not an afterthought (PRD §8.1). Today it lives in `src/lib/auth/scope.ts`, where a judge's projection of `teams` does not select `name` and the return type says so.

Postgres RLS is the eventual hardening. It is not built. [ADR-0006](decisions/0006-tenancy-app-layer-scoping-rls-later.md) says when to revisit.
