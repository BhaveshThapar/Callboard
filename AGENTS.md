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

The PRD gates the real v1 on three paid deposits (§13). Right now the repo contains **only** the judge-scoring demo (Module B). Do not build registration, payments, Stripe, the Gita, or the comms engine without being asked — they are designed in `docs/` and deliberately unimplemented. If a change starts pulling one of them in, stop and say so.

## Invariants

**Money is integer cents.** Columns are `*_cents integer`. Never float, never `numeric` read into a JS `number` for arithmetic. `payments` splits `gross_cents` / `fee_cents` / `net_cents`; a payment attaches to charges through `payment_allocations`, never directly. This is not fussiness — see the $97.01 deposit and the $2,160 lump in PRD §14.

**`src/lib/tabulation/` is pure.** No imports from `src/db/`, no `Date.now()`, no randomness. It takes `TabulationInput` and returns `TabulationResult`. This is what makes locked results reproducible a day later, and reproducibility is the thing being sold. Nothing new goes into `TabulationInput` without a reason that survives `reproducibility.test.ts` — `judge_notes` stays out for exactly this reason.

**Append, never mutate.** Scores are immutable after a lock, with no exception and no unlock. A post-lock correction is an attributed `deductions` row plus a re-tabulation, written as a new `tab_runs` row with `supersedes_id` and a reason; the superseded row keeps its own frozen inputs. `audit_log` gets a row for every write that touches scores, locks, or overrides.

**Every query is scoped.** Data access goes through `src/lib/auth/scope.ts`, which requires an `Actor`. There is no unscoped read of `teams` or `scores`. Blind judging is enforced here: a `judge` actor resolves a team to its `bid_code`, a `board` actor to its `name`.

**Every board action is attributed.** `BoardActor.personId` is non-nullable, because board links are per person (`board_assignments`), not per comp. Do not add an anonymous board path — `tab_runs.locked_by_person_id`, `deductions.created_by_person_id`, and `audit_log.actor_person_id` were all null before it, which made PRD B6's "attributed override" false.

## Code style

Follows the global AGENTS.md. Specifically enforced by ESLint here:

- No `any`. No `enum` — string literal unions.
- `type`, not `interface`.
- Functional. No classes.
- Tests live in `__tests__/` next to the source.
- No comments that restate the code. Comment only constraints the code cannot express.

## Testing

The acceptance bar is written in PRD §8.3 and encoded in `e2e/scoring.spec.ts`: 8 teams, 3 judges, phones, locked auditable placements in under ~5 minutes, reproducible the next day.

`src/lib/tabulation/__tests__/reproducibility.test.ts` is the one test that must never be weakened. It re-runs `tabulate()` against a stored snapshot and asserts deep equality. If it fails, the audit trail is a lie.
