# ADR-0006 — Tenancy by app-layer scoping now; Postgres RLS later

**Status:** accepted · July 9, 2026 · **amended August 15, 2026 — two of the three triggers have fired** · **amended August 18, 2026 — the mechanism is built and proven; it is not yet enabled**

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

**Two of the three triggers have fired — one outright, one quietly — and the third has not.** This is recorded here because a trigger nobody checks is a hope, which is the thing the section above says it is not. The count is stated rather than left to be inferred from the list, because an earlier draft of this line and the status line above it both read *all three*, while item 3 below says the opposite: a summary that disagrees with the list under it is exactly the defect the amendment was written to fix, one altitude up.

1. **Module A shipped.** A1–A3, A6–A10 and P1 are live. Money and personal contact information are in the database, so the cost of a leak is no longer hypothetical.
2. **A query outside `scope.ts` selects from `teams` or `scores` — at 14 sites across 7 files**: `src/db/doctor.ts`, `src/db/seed.ts`, `src/lib/comp/board.ts`, `src/lib/comp/public.ts`, `src/lib/comp/tab.ts`, `src/lib/drive/import.ts`, `src/lib/roster/roster.ts`. Several are legitimate — the seeder and the doctor are not request-scoped, and `public.ts` is one of the three deliberate `Actor`-less projections — but the ADR's own wording was *"if that happens, the invariant has already stopped being enforced by structure."* It has happened. Discipline did not scale, exactly as predicted.
3. **The first paying customer has not arrived.** Track 1 is 0/10 conversations and 0/3 signatures, so the one trigger that would make an isolation bug a *breach* rather than a bug is still unfired. That is the only reason this remains an amendment rather than a supersession.

**One claim in the Context section is wrong, and it is now measured rather than believed.** *"A serverless HTTP driver makes session state awkward"* was being leaned on as a *reason*. It is a cost: [`e2e/rls-spike.spec.ts`](../../e2e/rls-spike.spec.ts) puts the prefix at roughly **2–5% on an eight-way fan-out** — median 83ms bare against 85ms prefixed over nine rounds, recorded and deliberately not asserted against a threshold, because a latency budget nobody agreed to is a test that fails on somebody's bad afternoon. Awkward, still: every scoped read here is a fan-out — `listRosterForBoard` issues four queries, `boardSnapshot` eight — and each is a separate HTTP request needing its own prefix. But *awkward* is a cost to pay, and the objection to P3 is now policy design rather than latency.

**That claim was *believed* rather than *known* until the spike became a file, and this paragraph is the second correction to it.** The amendment's first draft said "the spike has been run" when no spike existed in this repository: no `set_config`, no `current_setting`, no `SET LOCAL` in `src/`, `drizzle/` or `e2e/`; `db.batch` with no callers; `*.local.ts` gitignored, so whatever was run left nothing behind. Two documents asserted a result nobody could reproduce, and the only way to discover it was to grep for something that is not there — which is why the rule now stated in `CLAUDE.md` is that a document may not claim a spike was run unless the spike is a file. **P3's first act was that probe, and it has landed.** What it found:

- **The mechanism carries.** A GUC set by `set_config` inside `db.batch` is readable by the next statement in the same batch.
- **And it does not leak.** The same GUC reads empty on the next request to the same pooled endpoint. **Both halves are asserted, because either alone passes vacuously** — this is the probe that decides whether the design is safe at all, and neither document had mentioned it.

Both paragraphs replace draft sentences rather than being appended under a second date, because the amendment had not yet merged when each was found: there was no history to preserve, only a PR to get right.

**What P3 must not inherit from this ADR.** Two things it does not say, both of which would make an RLS rollout inert rather than wrong:

- **RLS does not apply to the table owner.** `DATABASE_URL` is a single connection string and nothing in this repo mentions a non-owner role, so policies added today would exist, read correctly, and deny nothing. That is this codebase's signature defect — *written, with nothing reaching it* — in its purest form, and it would pass every test written against it. P3's first act is a `callboard_app` role without `BYPASSRLS`, and `db:doctor` asserting the app connects as a non-owner.
- **Not every table carries a scope key.** [DATA_MODEL.md](../DATA_MODEL.md) claimed it did, and was corrected on the same day as this amendment: `rubric_criteria`, `payment_allocations`, `sessions` and `message_events` carry neither `comp_id` nor `org_id`, and reach scope through one join each. A policy cannot be keyed on a column that is not there, so each needs a join policy or a denormalized column — a decision, not a detail.

The verification that matters is a **denial** test: connect as the app role, set the *wrong* `comp_id`, assert zero rows. A policy that permits is invisible, and a passing RLS suite that never proves a refusal is this ADR's failure mode wearing a green check.

**And one trap the probe covered, because a spike run by hand would have missed it.** `SET LOCAL app.comp_id = $1` is not valid SQL — Postgres refuses it with `syntax error at or near "$1"`, so `select set_config('app.comp_id', $1, true)` is the only parameterizable form. Somebody testing this in a console with a literal comp id gets a green result and writes the wrong mechanism down, which is approximately how this ADR acquired the sentence it spent two paragraphs correcting. The probe asserts the refusal *and its message*, so a compile error cannot satisfy it — an earlier draft passed by catching one, which is a green test asserting nothing, this repo's own recurring defect appearing inside the file written to close an instance of it.

## Amendment — August 18, 2026: four things measured, and one not finished

P3's mechanism now exists as code and is proven against the real schema. **It is not wired into any
read**, and this section says so in the same breath, because a policy layer that half-works is this
ADR's own stated failure mode — *"confidence without protection"*.

**1. The role must be created with raw SQL, and this is the finding that would have sunk it.**
`neondb_owner` has `rolbypassrls = true`. So does `neon_superuser`, **which every role created
through Neon's console or API inherits**. A `callboard_app` made the obvious way carries every policy
correctly and denies nothing — the purest form of this repo's recurring defect, and one that passes
every test written against it, because the tests would be asserting that the right rows come back.
`bun run db:rls-role` creates it with an explicit `NOBYPASSRLS` and then **verifies the flag**, rather
than trusting that it asked.

**2. The plumbing is a wrapper, not a rewrite.** This ADR deferred RLS partly on *"a session-variable
plumbing layer through a serverless driver"*. Drizzle's neon-http driver resolves its client as
`client.query ?? client`, so a `.query(sql, params, opts)` shim that wraps every statement in
`transaction([set_config, statement])` — **one HTTP round trip** — scopes everything drizzle issues
through it. `src/db/scoped.ts` is about fifteen lines. The cost this ADR was weighing was real and
the estimate of it was wrong.

**3. It cannot come from the connection string.** `?options=-c app.comp_id=…` reads back `null`;
neon-http does not forward startup parameters. The batch is the only mechanism, which is what makes
#33's probe load-bearing rather than incidental.

**4. It denies, and it fails closed.** Against the real schema on `dev`: the owner sees 81 teams; the
app role scoped to one comp sees 2, to another 5, and to a comp id that does not exist **0**. With no
`app.comp_id` set at all it also returns **0**, because the policies compare against
`nullif(current_setting('app.comp_id', true), '')::uuid` and a comparison with NULL is never true. A
request that forgets the prefix therefore sees nothing rather than everything, which is the only
direction this is permitted to fail in.

`0020` enables row-level security and adds those policies on **22 of 27 tables** — every table with
`comp_id`, `comps` on its own id, and `rubric_criteria`, `payment_allocations` and `message_events`
through the one join each that this ADR's previous amendment named. The other five — `orgs`,
`people`, `users`, `sessions`, `drive_connections` — are org- or user-scoped and outlive any comp; a
comp-keyed policy on them would deny every legitimate read. **That is a second axis, and it is stated
rather than left as an apparent oversight in a list that covers 22 of 27.**

### What is not done, and where the next person should start

`src/lib/auth/scope.ts` is **not** wired through `dbForComp`. It was, and the wiring was reverted.

The rewrite itself was mechanically correct — fourteen substitutions, each inside an actor-taking
projection, verified by mapping every call back to its enclosing function. `.select()` through the
scoped handle works; `listJudgeLabelsForBoard` through it returns its three labels; the denial probe
passes. But `bun run db:seed` fails its own verification under the app role, reproducibly, with
*"board view failed to load"*, *"judge view failed to load"* and *"only 0 of 3 judges have a Judge N
label"* — and `checkDemoHealth` catches the underlying error, so what it reports is the symptom.

**The first act of finishing P3 is to stop `checkDemoHealth` swallowing that error**, which is worth
doing on its own terms: a preflight whose whole job is to say what is wrong currently converts three
different failures into the same sentence.

Until the wiring lands, `DATABASE_URL_APP` is unset everywhere, the app connects as the owner, and
tenancy rests exactly where it has always rested — on `scope.ts` and the `where` clause in every
read. RLS here is defence in depth and it is not yet defending.
