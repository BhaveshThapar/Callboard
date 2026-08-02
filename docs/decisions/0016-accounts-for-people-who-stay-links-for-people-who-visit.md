# ADR-0016 — accounts for people who stay, links for people who visit

**Status:** accepted · August 2, 2026
**Related:** [ADR-0003](0003-judge-auth-via-signed-links.md), which made the link the credential; [ADR-0007](0007-board-links-are-per-person.md), which made board links per person; [ADR-0011](0011-nothing-mints-a-link.md), which refused to mint one and named this ADR's subject as the reason.

## Context

ADR-0011 closed a hole and left a bigger one open on purpose. Its own consequences section is the
brief for this decision:

> - **A judge no-shows and a substitute arrives.** The substitute cannot be given a link.
> - **A judge deletes the text.** Their link can be re-sent only if the person who ran the seed still has its output.
> - **A board member is added mid-week.** They get someone else's link, or they get nothing.

And its refusal was scoped, not absolute:

> It stays unbuilt anyway, because minting a link is not a small feature wearing a small hat. Issuing a credential to a person for a comp is **board management** — people, roles, invitations … and that is the thin end of Module A (A1–A4, and P1's real board accounts).

That thin end is now the work. Every remaining person-facing feature on the map needs to reach one
specific human: a team captain paying dues (A10) or uploading music (A4), a liaison reading their own
re-timed timeline (G4), a judge receiving the feedback they wrote (ADJ·2). None of them is reachable
through a credential nobody can issue.

The founding season's mitigation — *the founder runs the seed and keeps the output* — does not
survive contact with any of these. A dues reminder that requires a founder to have kept a terminal
buffer is not a product.

## Decision

**Accounts for people who stay. Links for people who visit.** The credential follows the
relationship, not the role name.

| | Credential | Why |
|---|---|---|
| Board member | **Account** | Manages money and a roster across a season; comes back weekly for months |
| Team captain | **Account** | Owes money, uploads materials, reads their own schedule; comes back for months |
| Liaison | **Account** | Holds duties across a comp day and needs their own timeline |
| **Judge** | **Link, unchanged** | Scores once, for three hours, as a favour. An account is friction charged to someone doing you a favour |

The judge case is the one worth defending rather than assuming. ADR-0003's argument — *no install,
no password, the link is the credential* — was made about a person who uses the product exactly once.
That argument is still true, and it is only true of judges. Making a judge create an account to score
eight teams would be the product asking a volunteer to do paperwork so the product's auth model could
be tidy.

**So both live, and the `Actor` union grows rather than being replaced:**

```
Actor = BoardActor | JudgeActor | TeamActor | LiaisonActor
```

`JudgeActor` continues to resolve from `judge_assignments.token_hash`. The other three resolve from a
session. `people` stays the identity — a `user` points at a `person`, so a liaison who is also a board
member is one human with one login and two sets of rights, which is the normal case at a student comp
and is unrepresentable today.

**Minting is now a thing that happens, and it happens as an invitation.** A board invites a person by
email; the invitation is a single-use token with an expiry; accepting it creates the account. This is
the "people, roles, invitations" surface ADR-0011 named, built deliberately rather than arrived at.

**What this does not do:** it does not delete a single link. `board_assignments` and
`judge_assignments` keep working, `revokeBoardAction` and `revokeJudgeAction` keep working, and a
comp seeded from a config still hands out board links that resolve. A founding partner mid-season
does not get migrated; they get a second way in.

## Consequences

**Two auth models coexist, and that is a real cost.** Every scoped read must be reachable from a
session-derived actor and a token-derived one, and `resolveBoardActor` now has two callers' worth of
shapes to satisfy. The alternative — migrating board links to accounts in one move — would break
every link already handed out, on a product whose whole preflight story is that links resolve.

**Sessions are a new thing to get wrong.** They get the treatment tokens already have: 32 random
bytes, stored as sha256 (`hashToken`), an expiry, a `revoked_at`, and revocation from the board
screen. No JWTs — a stateless session cannot be revoked, and revocability is the property ADR-0011
spent an entire decision on.

**Passwords are a new thing to get wrong, and the mitigation is to not be clever.** A constant-time
compare, no password hints, no security questions, email verification before the first login, and a
reset flow that expires. None of this is novel and none of it should be novel here.

**scrypt from `node:crypto`, not argon2.** argon2id is the better algorithm and would be the choice
if the two were otherwise equal. They are not: argon2 in Node is a native module, and this repo has
**five runtime dependencies** and deploys to serverless functions. Adding a compiled binary to that
is the clever move this paragraph just said not to make, and it buys a margin over scrypt that no
attacker of a student comp's roster will ever be near. OWASP lists scrypt as an acceptable choice at
`N=2^17, r=8, p=1`, which is what is used.

The trade is made survivable rather than permanent: the stored value is
`scrypt$N$r$p$salt$hash`, so **the algorithm is data**. Moving to argon2 later is a rehash on next
login behind a version check, not a flag day and not a forced reset for every account.

**`audit_log.actor_kind` becomes a migration.** It is a CHECK constraint over
`('board','judge','system')`; `team` and `liaison` are added by `0012`. This is the good kind of
friction — a new actor kind cannot be added by editing a type, which is exactly what you want of the
column that records who did what.

**A fourth and fifth window arrive, and CLAUDE.md forbids that casually.** The rule is *do not add a
window without a new question*, and both have one: a team may see its own row and no other team's,
and a liaison may see their own assignments and the schedule they hang off. Each is enforced where
the existing three enforce it — in the return type, so leaking is a compile error rather than a
review someone has to pass. Where a read can be built *on* an existing window instead, it is:
`listDepositsForBoard` is the precedent.

**The failure this trades away** is ADR-0011's list above — the substitute judge, the deleted text,
the board member added mid-week. All three become ordinary operations. **The failure it accepts** is
that Callboard now stores credentials for people, which it did not before, and is therefore worth
attacking in a way a per-comp token was not. P3's row-level security (ADR-0006) stops being an
eventual hardening and starts being scheduled work.
