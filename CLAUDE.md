# Callboard — project instructions

Read [`docs/PRD.md`](docs/PRD.md) before proposing product changes. It is the source of truth for scope, and it argues against building things.

## Commands

```bash
bun install
bun run typecheck     # tsc --noEmit
bun run lint          # eslint
bun run test          # vitest. Not `bun test` — that runs Bun's own runner over e2e/ and fails.
bun run e2e           # playwright
bun run db:generate   # after any src/db/schema change
bun run db:migrate
bun run db:seed                                    # the Mayuri demo
bunx tsx src/db/seed-cli.ts --config comp.json     # any comp; see comp-config.example.json
```

Run `typecheck`, `lint`, and `test` before calling any change done.

## Scope discipline

The PRD gates the real v1 on three signed founding partners (§13) — the founding season is free, so the signature, not a deposit, is the costly signal. Right now the repo contains **only** the judge-scoring demo (Module B). Do not build registration, payments, Stripe, the Gita, or the comms engine without being asked — they are designed in `docs/` and deliberately unimplemented. If a change starts pulling one of them in, stop and say so.

## Invariants

**Money is integer cents.** Columns are `*_cents integer`. Never float, never `numeric` read into a JS `number` for arithmetic. `payments` splits `gross_cents` / `fee_cents` / `net_cents`; a payment attaches to charges through `payment_allocations`, never directly. This is not fussiness — see the $97.01 deposit and the $2,160 lump in PRD §14.

**`src/lib/tabulation/` is pure.** No imports from `src/db/`, no `Date.now()`, no randomness. It takes `TabulationInput` and returns `TabulationResult`. This is what makes locked results reproducible a day later, and reproducibility is the thing being sold. Nothing new goes into `TabulationInput` without a reason that survives `reproducibility.test.ts` — `judge_notes` stays out for exactly this reason.

**Append, never mutate.** Scores are immutable after a lock, with no exception and no unlock. A post-lock correction is an attributed `deductions` row plus a re-tabulation, written as a new `tab_runs` row with `supersedes_id` and a reason; the superseded row keeps its own frozen inputs. `audit_log` gets a row for every write that touches scores, locks, or overrides.

**A correction replays the snapshot; it does not re-read the world.** `lockResults` builds `TabulationInput` from the live tables **only for the first lock**. An override takes the superseded run's frozen `inputs` and `config` and appends only the deductions its caller wrote — otherwise anything landing between the lock and the correction (a judge who lost the race with the lock button, a rubric weight edited after) enters the corrected result silently, and *nothing can detect it*: each run reproduces from its own row, so both verify while describing different worlds. Reproducibility is a property of one row; continuity is a property of the pair, and only `e2e/override.spec.ts` reads it. New deductions are passed in, never diffed out of the table, because `DeductionInput` has no id and no timestamp — which is also what keeps `TabulationInput` unchanged. The consequence is deliberate and must stay visible: a score landing after the lock enters **no run, ever**, and `scoresOutsideChain` is what says so on the board.

**A `teamId` on a form is a claim.** It has one check — `resolveTeamForJudge` / `resolveTeamForBoard` in `src/lib/auth/scope.ts` — and all four write paths (`submitScores`, `submitNote`, `addDeductionAction`, `overrideAction`) go through it. Do not write a fifth check; `addDeductionAction` is what a fourth *missing* one cost. `scores.team_id`, `judge_notes.team_id` and `deductions.team_id` are all bare FKs, so the database takes the row happily and `tabulate()` then filters it back out of the arithmetic — the write succeeds, the actor is told it worked, and it counts for nothing. A deduction that silently does not apply is worse than one that fails.

**A link can be killed; nothing mints one** ([ADR-0011](docs/decisions/0011-nothing-mints-a-link.md)). Both `judge_assignments.revoked_at` and `board_assignments.revoked_at` are now written, not just read. Board revocation stays available **after** the lock (a board link is the one that can still override) and refuses the **last** live link (nothing issues a replacement, and a reseed destroys the scores). Do not add a link-minting path — issuing a credential to a person is board management, which is Module A.

**Every query is scoped.** Data access goes through `src/lib/auth/scope.ts`, which requires an `Actor`. There is no unscoped read of `teams` or `scores`. Blind judging is enforced here: a `judge` actor resolves a team to its `bid_code`, a `board` actor to its `name`. A `teamId` arriving on a form is a claim, not a fact — check it against the scoped read that produced the form (`listTeamsForJudge` / `listTeamsForBoard`) before writing a row against it. `scores.team_id` is a bare FK, so the database will not catch a team from another comp.

**`teams` is the roster of record; a score is only evidence about it** ([ADR-0009](docs/decisions/0009-teams-is-the-roster-of-record.md)). Placements are driven by the scores, so a score naming a team not in `TabulationInput.teams` is ignored — otherwise a team that withdrew keeps the scores it was already given and goes on placing with them, above the teams that did compete. `tabulate()` filters for this itself, and that filter is **not** redundant with the query that loads it: it is what makes the function hold its contract for a snapshot replayed a year later. `SCOREABLE_STATUSES` has one definition, in `src/db/schema/teams.ts`. Do not write a second one.

**Every board action is attributed.** `BoardActor.personId` is non-nullable, because board links are per person (`board_assignments`), not per comp. Do not add an anonymous board path — `tab_runs.locked_by_person_id`, `deductions.created_by_person_id`, and `audit_log.actor_person_id` were all null before it, which made PRD B6's "attributed override" false.

**A comp is one division** ([ADR-0010](docs/decisions/0010-a-comp-is-one-division.md)). One rubric, one judge pool, one ranked list. Nothing downstream is division-aware and nothing should be: a board running two divisions gets two comps, which is what they are. `parseCompConfig` refuses a config declaring a second division — that is the only door, so it is where the refusal lives. `judge_assignments.division` was **dropped**: it read like an authorization key ("which teams may this judge see") and authorized nothing. `teams.division` stays because it only describes. Do not add a division column back without making the judge's window honor it.

**A comp's runs are one chain: one root, one head.** `tab_runs_root_unique` and `tab_runs_supersedes_unique` are both partial indexes and both load-bearing — the first refuses a second first-lock, the second a second override. Neither is redundant. `lockResults` checks before it inserts, but neon-http has no transactions, so the check and the insert are two acts and two board members can land between them; the database is the only thing that can actually refuse a fork. If a lock path catches a DB error, read `error.cause.constraint` — drizzle's own `message` is the failed SQL, and a board member must never be shown it.

Because the guarantee lives in the database rather than the code, **the code cannot assume it is there.** `db:doctor` looks both indexes up in `pg_indexes` and reports a comp with two roots by id — that is what makes the preflight mean "this database enforces the invariant", not merely "this demo is seeded". Reseeding is never offered as the remedy for either: it does not create an index, and it does not decide which of two locked results stood. Their names have one definition, `CHAIN_INDEXES` (and the `CHAIN_INDEX_NAMES` derived from it) in `src/db/schema/scores.ts`, because the schema, the lock path, and the doctor must agree on the strings and none can derive them. Do not write a second one — and note the *DDL* has one definition too, in the migration: `e2e/doctor.spec.ts` drops an index only after capturing `pg_get_indexdef`, and restores it by replaying what Postgres handed back.

**`db:doctor` splits pure from observed, and both halves need testing.** `summarizeHealth` in `src/db/health.ts` is pure and unit-tested; `src/db/doctor.ts` is what reads the database, and a wrong index name or a broken `GROUP BY` there would leave every unit test green while the doctor passed a database that can still fork a locked result. `e2e/doctor.spec.ts` drives each failure branch against a database actually in that state. It breaks the database and repairs it in a `finally` — and order matters: the fork must be cleared **before** the unique index goes back on, because it cannot be built over rows that violate it.

## Code style

Follows the global CLAUDE.md. Specifically enforced by ESLint here:

- No `any`. No `enum` — string literal unions.
- `type`, not `interface`.
- Functional. No classes.
- Tests live in `__tests__/` next to the source.
- No comments that restate the code. Comment only constraints the code cannot express.

## Testing

The acceptance bar is written in PRD §8.3 and encoded in `e2e/scoring.spec.ts`: 8 teams, 3 judges, phones, locked auditable placements in under ~5 minutes, reproducible the next day.

`src/lib/tabulation/__tests__/reproducibility.test.ts` is the one test that must never be weakened. It re-runs `tabulate()` against a stored snapshot and asserts deep equality. If it fails, the audit trail is a lie.
