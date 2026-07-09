# ADR-0006 — Tenancy by app-layer scoping now; Postgres RLS later

**Status:** accepted · July 9, 2026

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
