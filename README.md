# Callboard

*The operating system for a collegiate competition weekend.*

A single system of record for running a collegiate dance competition: team registration and payments, judge scoring and tabulation, the run-of-show schedule, and the announcements that tie them together. Today every comp runs this on Google Forms, a shared Gmail, Venmo, GroupMe, and a spreadsheet held together by one exhausted treasurer.

Read [`docs/PRD.md`](docs/PRD.md) for the full product argument and the evidence behind it.

## What exists right now

**The judge-scoring demo, complete — plus the first slice of registration.**

The PRD gates the real build on **three founding partners** by Sept 15, 2026 (§13). The founding season is free, so the costly signal is not a deposit: a partner is a named person and comp date, their real data in hand, and a written $300 line in the budget they hand their successors. Until that gate clears, the thing worth building is the sales instrument: three judges scoring eight teams from their phones, live tabulation on screen, locked and auditable placements in under five minutes.

**Module B (scoring, B1–B10) is done.** So is most of **Module A**: the public registration form (A1), the application → acceptance → waitlist lifecycle (A2), the roster joined to what each team owes (A3), and the money spine — fee schedule engine, refund state machine, fee-aware ledger, who-owes screen (A6–A9). Real accounts (P1) followed, and on top of them the comms engine and everything that has to reach one specific human: dues reminders (A10), receipts, judge feedback delivery (ADJ·2), announcements, and an invitation that sends itself. All of it was built in July–August 2026 at the founder's direction, **ahead of the gate and against the PRD's own advice**. That is recorded rather than tidied away — [`docs/FEATURE_MAP.md`](docs/FEATURE_MAP.md) sequences the build and does not authorize it, and this is what it looks like when the sequence runs early. Track 1 is still 0/10 conversations and 0/3 signatures, and no line of code moves it.

**The line now holds at Stripe.** Still **designed** in `docs/` and **not built**: Stripe Connect and the card rails (A5–A5c), the materials half of the team portal (A4, which needs a place to put a file), the Gita, and liaison coordination (C1). The ledger closes the ~$5,000 reconciliation gap on hand-entered Venmo rows, so routing buys ingestion rather than correctness — and whether a student board wants card rails is a question for the founding partners. See [`docs/FEATURE_MAP.md`](docs/FEATURE_MAP.md) for the whole map and the gate it sits behind.

**One caveat the map is strict about:** the comms tier is written, tested and merged, and **nothing has ever been sent from the deployed database.** Sending is opt-in on a key and a from-address that production does not have, so the engine there records instead of sending. `Live` in this repo means a board can reach it *on production*, and those rows do not read `Live`.

## Quickstart

```bash
bun install
cp .env.example .env.local     # fill in DATABASE_URL from your Neon project
bun run db:migrate
bun run db:seed                # 8 teams, 3 judges — prints the judge links
bun run dev
```

The seed prints three `/judge/<token>` URLs, one `/board/<token>` URL and one `/invite/<token>` URL. Open one judge link per phone and the board link on a laptop — the board link exchanges itself for a cookie and lands you in the product at `/app/<org>/<comp>` ([ADR-0022](docs/decisions/0022-a-link-is-exchanged-for-a-cookie.md)). The invitation is the same screens reached by signing in instead.

To run the demo cold in front of someone, follow [`docs/DEMO.md`](docs/DEMO.md).

## Commands

| | |
|---|---|
| `bun run dev` | Next dev server |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | ESLint |
| `bun run test` | Vitest unit tests (not `bun test` — that runs Bun's own runner over `e2e/`) |
| `bun run e2e` | Playwright acceptance test |
| `bun run db:generate` | Generate a migration from schema changes |
| `bun run db:migrate` | Apply migrations |
| `bun run db:seed` | Seed the Mayuri demo. **Refuses a protected org** — a reseed destroys real scores |
| `bun run db:doctor` | Preflight: does this database still enforce the invariants? Run it before every prospect call |
| `bun run db:studio` | Drizzle Studio |

## Documentation

| Doc | What's in it |
|---|---|
| [PRD.md](docs/PRD.md) | The product argument, the problem, the evidence base |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | One record, many windows, one comms engine |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Every table, including the ones not yet migrated |
| [TABULATION.md](docs/TABULATION.md) | Normalization, deductions, tiebreaks, locking |
| [PAYMENTS.md](docs/PAYMENTS.md) | Stripe Connect design. Not implemented. |
| [ROADMAP.md](docs/ROADMAP.md) | Phasing, and the go/no-go gates |
| [PIPELINE.md](docs/PIPELINE.md) | The gate, counted: conversations, founding partners, league check |
| [INTAKE.md](docs/INTAKE.md) | What to ask a founding partner for, and what it buys them |
| [FEATURE_MAP.md](docs/FEATURE_MAP.md) | Every feature, its status, and the gate that sequences it |
| [DEMO.md](docs/DEMO.md) | Running the sales demo |
| [decisions/](docs/decisions/) | ADRs — why the load-bearing choices were made |

## Stack

Next.js 15 (App Router) · TypeScript strict · Tailwind · Drizzle ORM · Neon Postgres · Vercel · Vitest · Playwright.

## Invariants

Three rules that the codebase does not bend on. Each has an ADR.

1. **Money is integer cents.** Never a float, never a `number` that could hold `97.009999`. Payments record `gross`, `fee`, and `net` separately.
2. **Tabulation is pure.** `src/lib/tabulation/` imports nothing from `src/db/`. Results are a deterministic function of their inputs, which is why locked results reproduce.
3. **Nothing is deleted.** Scores, locks, and overrides append. `audit_log` is the record of what happened, and it is the product.
