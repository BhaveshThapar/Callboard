# ADR-0007 — Board links are per person, so a lock has a name on it

**Status:** accepted · July 9, 2026
**Supersedes:** the board-link half of [ADR-0003](0003-judge-auth-via-signed-links.md). Judge links are untouched.

## Context

PRD B6 promises *"nothing editable after lock without a logged, attributed override."*

The override machinery existed and was half true. `lock_results` refused a second lock without a reason, wrote `supersedes_id` and `override_reason`, and never mutated the prior row. But `comps.board_token_hash` authorized a **comp**, not a person, so `BoardActor` carried no identity. Three columns had been designed for attribution and were, in every row ever written, null:

- `tab_runs.locked_by_person_id`
- `deductions.created_by_person_id`
- `audit_log.actor_person_id`, for every board action

An override was therefore logged, reasoned, and anonymous. In a dispute — the exact scenario this product is sold against — the audit trail could say a correction happened and why, but not who authorized it. That is the half of B6 that matters when a coach is standing at the tab table.

## Decision

`board_assignments` mirrors `judge_assignments`: `comp_id`, `person_id`, `token_hash` (unique), `revoked_at`. One link per board member. `comps.board_token_hash` is dropped.

`BoardActor.personId` is **non-nullable**. There is no anonymous fallback and no shared comp-wide link, because either would reintroduce exactly the hole being closed. An unattributed lock is now unrepresentable rather than merely discouraged — the same technique `JudgeTeamView` already uses, where blindness is enforced by the absence of a `name` field rather than by remembering not to select it.

`resolveBoardActor` becomes a line-for-line mirror of `resolveJudgeActor`, including the `revoked_at IS NULL` filter. Board links get revocation for free.

## Consequences

**Good.** Every lock, correction, and deduction names a person, on screen in the audit trail and in the database. Board links are revocable, which they were not. Auth has one shape instead of two. The seed still prints four links for the demo — one board member, three judges — so DEMO.md's script is unchanged.

**The cost.** A board member can no longer forward their link to a co-chair without impersonating them. That is a real regression in convenience, and it is the point: the whole value of the column is that the name in it is true. Adding a second board member is one line of `comp-config.json`.

This inherits the bearer-token tradeoff from ADR-0003 unchanged. A board link in a group chat is still a board link. The blast radius is now a *named* board member's authority, which is worse to lose and easier to revoke.

## When this changes

Module A introduces real board accounts — email, sessions, the hardening ADR-0003 lists — because it introduces money and contact information. At that point `board_assignments` becomes a fallback for the volunteer who cannot log in on comp morning, not the primary path. The `person_id` on it survives that migration intact, which is the reason to write it now rather than then.
