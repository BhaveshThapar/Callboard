# Architecture

> One record, many windows, one comms engine. — PRD §6

## The thesis, in code

There is a single canonical comp record: People, Teams, Money, Schedule, Assignments. Committees are **readers and writers of that record**, not separate modules. Registration writes roster rows; Finance writes paid/owed against the same rows; Logistics writes a schedule that references the same teams.

What each person sees is a **role-filtered projection** of that one record. This is not a UI convention — it is enforced in the query layer.

The clearest instance of the thesis in the current code is blind judging. A judge and a board member look at the same `teams` row and see different things:

```ts
// src/lib/auth/scope.ts
listTeamsForJudge(actor)  // selects id, bid_code, performance_order
listTeamsForBoard(actor)  // selects id, bid_code, performance_order, name, school
```

The judge's function does not select `teams.name`. Blindness is a property of the projection, not a flag on a page, and the return type makes a leak a compile error rather than a code review catch.

## Layers

```
src/app/          Next.js routes. Server components read; server actions write.
src/lib/auth/     Actor resolution + the scoped projections. Every read passes through here.
src/lib/comp/     Comp services: build tabulation input, lock, board snapshot.
src/lib/audit/    Append-only log of everything that touched a score, a lock, or an override.
src/lib/tabulation/  Pure. No database. No clock. No randomness.
src/db/           Drizzle schema + migrations + seed.
```

The dependency arrow only ever points downward. `src/lib/tabulation/` sits at the bottom and imports nothing from the rest of the app, which is what makes it exhaustively testable and what makes a locked result reproducible.

## Why tabulation is pure

`tabulate(input, rubric) -> result` is a deterministic function. Given the same arguments it returns a byte-identical answer, forever.

Locking a comp writes one `tab_runs` row holding the frozen `inputs`, the frozen `config` (the rubric), and the `results` the function returned. Reproducing last February's placements means loading that row and calling the function again. If the output differs, something was tampered with — and `reproduce()` says so on the board screen.

Two details make this hold that are easy to get wrong:

- **Canonical ordering.** Float addition is not associative and Postgres makes no promise about row order. `aggregate.ts` sorts scores by `(judgeId, teamId, criterionId)` before summing. Without this, re-running a snapshot could differ in the last bit.
- **`json`, not `jsonb`.** `jsonb` reorders object keys and collapses duplicates. A snapshot column must return the bytes that went in, so `tab_runs.inputs/config/results` are `json`.

## Authentication

There isn't a user table with passwords, and for the scoring demo there does not need to be.

- A **judge** gets a URL containing a 32-byte token. The database stores only its sha256. First load resolves the token to a `judge_assignments` row, which names the comp and the person. Revoking is a board action, not a SQL statement someone runs by hand.
- A **board member** gets a URL of their own, using the identical primitive against `board_assignments`. It authorizes the tab view, deductions, the lock, and corrections.

Board links are **per person, not per comp**. PRD B6 promises a *logged, attributed* override, and a link shared by the whole board can only ever name the board. `BoardActor.personId` is non-nullable, so an unattributed lock is unrepresentable rather than merely discouraged — the same trick `JudgeTeamView` uses to make a leaked team name unrepresentable. See [ADR 0007](decisions/0007-board-links-are-per-person.md).

This satisfies the hard requirement in PRD §8.2 B2: score from any browser on a phone, no app install. It also means a link can be texted, and a leaked link can be killed from the board screen.

**Real board accounts arrived with P1, and board access moved onto them in [ADR-0022](decisions/0022-a-link-is-exchanged-for-a-cookie.md).** The rule is *accounts for people who stay, links for people who visit*: board, captain and liaison sign in; a judge does not, forever, because ADR-0003's no-install argument is an argument about somebody who uses the product exactly once.

So a `BoardActor` now has **two origins, and exactly one function knows it** — `resolveBoardAccess(compId)` in `src/lib/auth/access.ts`. It tries the account session first, then a board-link cookie. Everything downstream takes the actor and cannot tell which, which is the property worth having: three windows, twenty writes and every `audit_log` row are unchanged.

The link path must prove `actor.compId === compId`, and that single line is the security of the whole arrangement: `membershipFor` is scoped by construction, and a token is not. `e2e/scope.spec.ts` drives it.

`src/lib/auth/access.ts` is separate from `scope.ts` for a mundane and load-bearing reason: `scope.ts` is imported by `src/db/doctor.ts`, which runs as a CLI with no request behind it, and pulling `next/headers` in there would break the preflight at import time.

## Routes

```
/                          home · sign in · comps taking applications
/app                       dashboard — the comps this session may open
/app/[org]/[comp]/…        the product, behind a shell that knows your role
/board/[token]/…           the door: resolve, set a cookie, redirect into /app
/judge/[token]             unchanged, forever (ADR-0003)
/c/[org]/[comp]            public, Actor-less
/register/[org]/[comp]     public, Actor-less
```

The credential used to be the first segment of every board URL. It is a cookie now, so a URL names a place and the address bar, the history and a screenshot of the demo stop carrying a bearer token. `/board/[token]/[[...rest]]` is one optional catch-all, which is what keeps every emailed link and every line of `DEMO.md` correct.

## Writes

Server actions, not API routes, with one exception. Actions co-locate validation with the mutation and degrade gracefully — the judge scoring form is a plain `<form>` and submits without JavaScript.

The exception is `GET /api/board/[comp]`, which the live board polls every two seconds. Keyed on the comp rather than a credential since [ADR-0022](decisions/0022-a-link-is-exchanged-for-a-cookie.md) moved the credential into a cookie — the id says what is being asked about, and `resolveBoardAccess` says whether this browser may hear the answer. Polling, not websockets: eight teams and three judges do not justify a socket, and a dropped poll self-heals on the next tick.

## Append, never mutate

- Scores upsert while the comp is open and are refused once a `tab_runs` row exists.
- A correction after the lock does not edit anything. It inserts a **new** `tab_runs` row with `supersedes_id` pointing at the old one and a required `override_reason`.
- `audit_log` gets a row for every score submission, deduction, lock, and override, attributed to an actor.

The audit trail is not instrumentation. It is the product. Paper clipboards in a folder in someone's apartment cannot produce it (PRD §14).

## What is deliberately absent

No Stripe, and no routing of any kind. No Gita. No row-level security. Still no place to put a file — but A4's materials half no longer waits on one, because it takes a **link**, as A1 always did for the audition video, behind a `putMaterial` seam a blob store can land in without a migration. Each is designed — see [DATA_MODEL.md](DATA_MODEL.md), [PAYMENTS.md](PAYMENTS.md), and [FEATURE_MAP.md](FEATURE_MAP.md) — and each waits behind the founding-partner gate in PRD §13.

**Two things this section said until August 2026 and no longer can.** `Actor` is no longer `BoardActor | JudgeActor`: P1 added `team` and `liaison`, and *something* mints a link now — an invitation, which names who it is for before it is accepted ([ADR-0016](decisions/0016-accounts-for-people-who-stay-links-for-people-who-visit.md), the successor ADR-0011 named for itself). And there **is** a comms engine ([ADR-0020](decisions/0020-a-message-sends-once.md)): an outbox whose guarantee is a unique index, swept on a schedule, with five product paths queueing into it. What is still absent there is not code — it is a sending credential on the deployed database, so production records rather than sends.

**Registration and the money spine are the exception, and it is a deliberate one.** The public form (A1) and the application → acceptance → waitlist lifecycle (A2) were built in July 2026 ahead of that gate, at the founder's direction; A3 and A6–A9 followed on July 31 – August 1. They brought two things into the architecture that the rest of this document should be read against: the **first unauthenticated read in the product** (`openRegistration`, where the applicant is nobody yet, so the projection *is* the scope — `publicComp` is the second, and follows its terms), and **transactions** (`withTransaction`, [ADR-0012](decisions/0012-transactions-for-writes-that-span-statements.md) — `db` is neon-http, which has none).

There are **four** transactional callers, counted by invariant rather than by call site — the first two named in ADR-0012 before either arrived. The **roster**, where a roster fact and the obligations it implies must land together (`setTeamStatus`, `setTeamBilling`, `regenerateCharges`). The **ledger**, where a payment row, its allocations and the counter that constrains them are one act. The **deposit ending** ([ADR-0015](decisions/0015-a-refund-moves-the-money.md)), where a terminal event and the money it returns land together or a deposit reads `refunded` while the team still owes it. And **accepting an invitation** ([ADR-0016](decisions/0016-accounts-for-people-who-stay-links-for-people-who-visit.md)), where an envelope is spent exactly when the authority it grants exists. That is why the count is four while `grep` finds eight. Writes stay on neon-http everywhere else — including the **outbox**, whose claim is deliberately one guarded `UPDATE` rather than a transaction ([ADR-0020](decisions/0020-a-message-sends-once.md)), and `lockResults`, which stays there on purpose: a unique index refuses a fork from code that never opens a transaction.

The money half now exists. `charges`, `payments`, `payment_allocations` and `deposit_events` landed in migrations `0009` and `0010`, and A3 joins the roster to what each team owes in one record. What it does **not** do is move any money: every row is hand-entered on a rail the schema records and never routes, which is precisely what lets the ledger close PRD §14's gap without Stripe.

Multi-tenancy today is app-layer: every table carries `comp_id`, and reads go through `src/lib/auth/scope.ts`. Postgres RLS is the eventual hardening, recorded in [ADR-0006](decisions/0006-tenancy-app-layer-scoping-rls-later.md), not a thing to build before the first customer.
