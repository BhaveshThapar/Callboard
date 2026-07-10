# Callboard

*The operating system for a collegiate competition weekend.*

A single system of record for running a collegiate dance competition: team registration and payments, judge scoring and tabulation, the run-of-show schedule, and the announcements that tie them together. Today every comp runs this on Google Forms, a shared Gmail, Venmo, GroupMe, and a spreadsheet held together by one exhausted treasurer.

Read [`docs/PRD.md`](docs/PRD.md) for the full product argument and the evidence behind it.

## What exists right now

**A judge-scoring demo, and nothing else.** This is deliberate.

The PRD gates the real build on three paid deposits by Sept 15, 2026 (§13). Until that gate clears, the only thing worth building is the sales instrument: three judges scoring eight teams from their phones, live tabulation on screen, locked and auditable placements in under five minutes. That is what this repo contains.

Registration, payments, Stripe Connect, the Gita, and the comms engine are **designed** in `docs/` and **not built**. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Quickstart

```bash
bun install
cp .env.example .env.local     # fill in DATABASE_URL from your Neon project
bun run db:migrate
bun run db:seed                # 8 teams, 3 judges — prints the judge links
bun run dev
```

The seed prints three `/judge/<token>` URLs and one `/board/<token>` URL. Open one judge link per phone, the board link on a laptop, and watch scores land.

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
| `bun run db:seed` | Reset and seed demo data |
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
| [DEMO.md](docs/DEMO.md) | Running the sales demo |
| [decisions/](docs/decisions/) | ADRs — why the load-bearing choices were made |

## Stack

Next.js 15 (App Router) · TypeScript strict · Tailwind · Drizzle ORM · Neon Postgres · Vercel · Vitest · Playwright.

## Invariants

Three rules that the codebase does not bend on. Each has an ADR.

1. **Money is integer cents.** Never a float, never a `number` that could hold `97.009999`. Payments record `gross`, `fee`, and `net` separately.
2. **Tabulation is pure.** `src/lib/tabulation/` imports nothing from `src/db/`. Results are a deterministic function of their inputs, which is why locked results reproduce.
3. **Nothing is deleted.** Scores, locks, and overrides append. `audit_log` is the record of what happened, and it is the product.
