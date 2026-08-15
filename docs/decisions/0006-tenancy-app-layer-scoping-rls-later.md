# ADR-0006 — Tenancy by app-layer scoping now; Postgres RLS later

**Status:** accepted · July 9, 2026 · **amended August 15, 2026 — all three triggers have fired**

## Context

PRD §8.1: *"Permissions: role-based row/field filtering is a first-class primitive, not an afterthought. Every external view is a filtered projection of the record."*

The record is comp-scoped and multi-tenant — many orgs, many comps per org, isolated. Judges, team captains, liaisons, and attendees are all external users reading slices of the same tables.

Postgres row-level security is the strong form of this. It is also a real cost: every connection needs a per-request `SET LOCAL` of the actor, policies must be written and tested per table, and a serverless HTTP driver makes session state awkward. Getting RLS subtly wrong is worse than not having it, because it produces confidence without protection.

## Decision

**Now:** every table carries `comp_id` (and `org_id` where it outlives a comp). Every read goes through `src/lib/auth/scope.ts`, which requires a resolved `Actor`. There is no unscoped read of `teams` or `scores` anywhere in the codebase.

Field-level filtering is enforced by **separate functions with separate return types**, not by a runtime flag:

```ts
listTeamsForJudge(actor: JudgeActor): Promise<JudgeTeamView[]>   // no `name` column, ever
listTeamsForBoard(actor: BoardActor): Promise<BoardTeamView[]>   // name + school
```

A judge leaking a team name is a compile error, not something a reviewer has to catch. This is the "one record, many windows" thesis expressed in the type system.

**Later:** RLS as defense in depth.

## Why not RLS today

There is one tenant, one comp, and no money. The threat RLS defends against — a query that forgets its `where comp_id = ?` — is currently defended by there being four query functions, all in one file, all tested.

Buying RLS now costs a session-variable plumbing layer through a serverless driver, a policy per table, and a class of debugging that is genuinely unpleasant, in exchange for protecting data that does not exist yet. That is the definition of a premature commitment.

The honest risk: app-layer scoping degrades as the codebase grows and the number of query sites multiplies. Discipline does not scale. Which is why the trigger below is a trigger and not a hope.

## Trigger to revisit

**Whichever comes first:**

1. **The first paying customer** — the moment a second org's data sits in the same database, an isolation bug becomes a breach rather than a bug.
2. **Module A ships** — money and personal contact information raise the cost of a leak by an order of magnitude.
3. **A query outside `src/lib/auth/scope.ts` selects from `teams` or `scores`.** If that happens, the invariant has already stopped being enforced by structure, and it needs to be enforced by the database.

Until then, `scope.ts` is the boundary, and CLAUDE.md says so.

## Amendment — August 15, 2026

**Two of the three triggers have fired outright, and the third has fired quietly.** This is recorded here because a trigger nobody checks is a hope, which is the thing the section above says it is not.

1. **Module A shipped.** A1–A3, A6–A10 and P1 are live. Money and personal contact information are in the database, so the cost of a leak is no longer hypothetical.
2. **A query outside `scope.ts` selects from `teams` or `scores` — at 14 sites across 7 files**: `src/db/doctor.ts`, `src/db/seed.ts`, `src/lib/comp/board.ts`, `src/lib/comp/public.ts`, `src/lib/comp/tab.ts`, `src/lib/drive/import.ts`, `src/lib/roster/roster.ts`. Several are legitimate — the seeder and the doctor are not request-scoped, and `public.ts` is one of the three deliberate `Actor`-less projections — but the ADR's own wording was *"if that happens, the invariant has already stopped being enforced by structure."* It has happened. Discipline did not scale, exactly as predicted.
3. **The first paying customer has not arrived.** Track 1 is 0/10 conversations and 0/3 signatures, so the one trigger that would make an isolation bug a *breach* rather than a bug is still unfired. That is the only reason this remains an amendment rather than a supersession.

**One claim in the Context section is now known to be wrong.** *"A serverless HTTP driver makes session state awkward"* — the spike has been run, and `db.batch` carries a `SET LOCAL` and its query as one transaction over neon-http ([ARCHITECTURE.md](../ARCHITECTURE.md), *What is deliberately absent*). Awkward, still: every scoped read here is a fan-out — `listRosterForBoard` issues four queries, `boardSnapshot` eight — and each is a separate HTTP request needing its own prefix. But *awkward* is a cost to pay, not a reason, and this ADR was leaning on it as a reason.

**What P3 must not inherit from this ADR.** Two things it does not say, both of which would make an RLS rollout inert rather than wrong:

- **RLS does not apply to the table owner.** `DATABASE_URL` is a single connection string and nothing in this repo mentions a non-owner role, so policies added today would exist, read correctly, and deny nothing. That is this codebase's signature defect — *written, with nothing reaching it* — in its purest form, and it would pass every test written against it. P3's first act is a `callboard_app` role without `BYPASSRLS`, and `db:doctor` asserting the app connects as a non-owner.
- **Not every table carries a scope key.** [DATA_MODEL.md](../DATA_MODEL.md) claimed it did, and was corrected on the same day as this amendment: `rubric_criteria`, `payment_allocations`, `sessions` and `message_events` carry neither `comp_id` nor `org_id`, and reach scope through one join each. A policy cannot be keyed on a column that is not there, so each needs a join policy or a denormalized column — a decision, not a detail.

The verification that matters is a **denial** test: connect as the app role, set the *wrong* `comp_id`, assert zero rows. A policy that permits is invisible, and a passing RLS suite that never proves a refusal is this ADR's failure mode wearing a green check.
