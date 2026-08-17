# ADR-0013 — a seed replaces a comp, not an org

**Status:** accepted · July 30, 2026
**Related:** [ADR-0010](0010-a-comp-is-one-division.md), whose "two divisions are two comps" this makes true in the one place that had to honor it — and [INTAKE.md](../INTAKE.md), which was already promising it to treasurers.

## Context

ADR-0010 decided that a comp is one division, and that a board running two divisions gets **two comps**. [`docs/INTAKE.md`](../INTAKE.md) — the page written to be forwarded to a treasurer — says so to the customer in as many words: *"If you run divisions, send each one separately… You get a board screen and a set of judge links per division."*

`seedFromConfig` deleted by **org slug**:

```ts
await db.delete(orgs).where(eq(orgs.slug, config.org.slug));
```

So a founding partner who did exactly what INTAKE told them to — send fusion, then send classical — had their fusion division **deleted by the seeding of their classical one**: its comp, its teams, its rubric, its scores, and the judge links already on their phones. The org delete cascaded to every comp underneath it.

This is the same shape as ADR-0010's own bug and ADR-0009's before it: a document asked a board for something, the code accepted it without complaint, and then quietly did the wrong thing with it. What makes this one the worst of the three is **where it sits**. It is not latent and it is not on the demo path — it is on the path from *a board says yes* to *their comp is live*, which is the only code path the founding-partner gate (PRD §13) actually runs through. The first thing a signature buys is a seed, and the second seed ate the first.

The protected-database guard would have caught it on prod, but its message was written for the reseed case and reads backwards here:

> Seeding a *new* comp here is fine — this only fires because that org already exists.

The operator's second division **is** a new comp. Told that, and told the fix is `--force`, they would have forced it — and destroyed the division the guard had just saved. Off the protected database it destroyed silently, with no guard at all.

## Decision

**The unit a seed replaces is the comp.** `seedFromConfig` deletes by `(org_id, comp.slug)` — which `comps_org_slug_unique` already made the identity of a comp — and everything a comp owns cascades from it: teams, rubrics, both kinds of assignment, `comp_roles`, scores, deductions, `tab_runs`, `audit_log`. A sibling comp under the same org is untouched.

**`orgs` and `people` are found-or-created, never deleted.** `orgs` is documented in the schema as *"persists across years — the institutional memory a board cannot otherwise hand off,"* and a seed deleting it every run contradicted that on the first line. `people` hangs off the org, not the comp, so it survives the comp delete and **must** be reused: `people_org_email_unique` would refuse a second insert of a board whose members carry emails, which is every reseed of the demo. Reuse is also right on its own terms — one human on two of an org's divisions is one person holding a link per comp, which is what `board_assignments` already models.

**`liveLinksAtRisk` counts the target comp, not the org.** Otherwise the guard refuses the seed that *creates* division two, on the grounds that division one has live links — which are not at risk, and are exactly what the fix protects.

## Consequences

A board running two divisions now gets what INTAKE promised: two comps, one org, a board screen and a judge panel each, and seeding the second does not disturb the first. The same treasurer and tab chair can sit on both and hold one link per comp.

**A reseed is still destructive, and still guarded.** Seeding the same `comp.slug` twice replaces that comp and reissues its tokens — the links a prospect is holding stop resolving. That is unchanged, it is what `db:seed`'s protected-database refusal exists for, and the refusal now names the comp it would destroy and says plainly that a *different* `comp.slug` under the same org creates rather than replaces.

**A person is matched by email, or by name when the config gives no email.** Two different humans sharing a name in one org, with no emails, collapse into one person. The seeder is founder-run against a hand-written config (PRD §12), so this is a limit worth naming rather than a hazard worth engineering around; giving them emails resolves it.

**A person dropped from a config is not deleted.** Their `comp_roles` and their assignment die with the comp, so they lose their link and vanish from the comp — but the `people` row stays in the org. That is the institutional memory working as intended, not a leak: `people` carries no scores, and every read is comp-scoped.

**The same is now true of an applicant.** Registration (A1) writes a `people` row for a team's captain and points `teams.contact_person_id` at it, and `people` is org-scoped like everything else in that table. So reseeding a comp takes the teams and leaves their captains behind — inert, because the team they were a contact *for* went with the comp and there is no read of `people` that is not comp-scoped. `apply` already upserts on `(org_id, email)`, so a captain who applies again after a reseed is the same person, which is the same rule this ADR applies to a board member sitting on two divisions.

Nothing here touches `src/lib/tabulation/`, so no locked snapshot replays differently. `reproducibility.test.ts` is untouched and green.

`e2e/two-divisions.spec.ts` is the witness, and it was falsified before it was trusted: restore the org delete and division one's board link 404s the moment division two is seeded. It also seeds one comp twice, which is the path that would trip `people_org_email_unique` if the seed ever re-inserted a board instead of finding it — the reseed before every prospect call runs straight through there.

### What this does not build

**Nothing mints a link, and that is still deliberate.** A person added to a comp after it is seeded still cannot be given a link without a reseed, and a lost board link is still unrecoverable from inside the product. ADR-0011 argued that a mint path is the thin end of board management, which is Module A and gated on PRD §13, and that argument is unchanged — this ADR narrows the blast radius of a seed, it does not add a way to avoid one.

**There is still no setup UI.** Two divisions means two hand-written configs and two founder-run seeds. FEATURE_MAP P2 keeps that deferred on purpose (PRD §12: white-glove founding support).

## Amendment — August 16, 2026

`comp_roles` appears twice above, in the list of what cascades from a comp and in the note about a
person dropped from a config. **That table was dropped in `0016` with C1**, having never had a
reader; `assignments` replaced it. Neither sentence's *point* changes — a comp still owns everything
that cascades from it, and a person dropped from a config still keeps their `people` row while
losing their access — so the body is left as written rather than edited, which is how the record of
what was true in July stays readable. This note is what stops the stale name being mistaken for a
live table.
