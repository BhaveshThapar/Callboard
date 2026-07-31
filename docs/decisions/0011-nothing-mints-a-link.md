# ADR-0011 — a link can be killed, but nothing mints one

**Status:** accepted · July 12, 2026
**Related:** [ADR-0003](0003-judge-auth-via-signed-links.md), which made the link the credential; [ADR-0007](0007-board-links-are-per-person.md), which made board links per person and claimed revocation came with it; [ADR-0010](0010-a-comp-is-one-division.md), whose *"what this does not build"* section recorded the board-revocation hole this closes.

## Context

The link **is** the credential (ADR-0003). A judge's authority is a 32-byte token in a URL; a board member's is the same. Which means every question about who may act on a comp is really a question about who holds a link — and there are only three such questions:

1. **Can a link be killed?** For judges, yes, since ADR-0007. For board members, **no** — until now.
2. **Can a link be issued?** No. Not to anyone, ever, except by seeding the comp.
3. **Can a link be re-sent?** Only if whoever ran the seed still has the output. The raw token is printed once and stored as a sha256; the database cannot tell you what it was.

The first was a live hole, and it was the dangerous one. `board_assignments.revoked_at` was *read* by `resolveBoardActor` and **written by nothing.** ADR-0007 said board links "get revocation for free" when it made them per-person — that was true of the read path and false of the write path, and nobody checked. So a board link that leaked could still lock results, override a locked result, and apply deductions, all attributed to the named person it was issued to, and the only way to kill it was `UPDATE board_assignments` by hand.

The second and third are the ones that will actually bite a comp, and they cannot be fixed the same way.

## Decision

**A link can be killed. Nothing mints one.**

`revokeBoardAction` closes the hole, mirroring `revokeJudgeAction`, with two deliberate asymmetries:

- **It stays available after the lock**, where judge revocation does not. A judge whose link dies after the lock loses nothing — scoring is closed. A board link is the opposite: it is the link that can still *override a locked result*, so the moment a leaked one matters most is precisely the moment the judge rule would have forbidden killing it.

- **It refuses the last live link.** A board that revoked its way to zero would be locked out of its own comp, mid-night, with no instrument to get back in — because of the rest of this ADR. The button is hidden when one link remains; the *server* is what refuses, because the button is not the guarantee.

**Minting stays unbuilt, and that is a decision, not an oversight.** Callboard has exactly one code path that issues a link, `seedFromConfig`, and it deletes the comp before it writes ([ADR-0013](0013-a-seed-replaces-a-comp-not-an-org.md)) — so it reissues *every* token for that comp. It cannot add a judge without revoking the eight already scoring. `seed-cli` already knows this and refuses to reseed a comp whose links are live, which means that on comp day there is genuinely no path: not a blocked one, not a dangerous one, **none**.

## Consequences

These are the failures this buys, stated plainly, because a board should hear them from us before it hears them from its own comp night:

- **A judge no-shows and a substitute arrives.** The substitute cannot be given a link. The comp runs with the panel it was seeded with, or the founder re-seeds and re-hands every link in the room.
- **A judge deletes the text.** Their link can be re-sent only if the person who ran the seed still has its output. Nothing in the product can recover it — only the sha256 is stored, which is the point of ADR-0003 and is not being traded away.
- **A board member is added mid-week.** They get someone else's link, or they get nothing.

On demo day none of this is visible: the comp is seeded minutes before, by the person holding the tokens. On comp day it is the thing that goes wrong.

It stays unbuilt anyway, because minting a link is not a small feature wearing a small hat. Issuing a credential to a person for a comp is **board management** — people, roles, invitations, the ability to add a judge who was not in the config — and that is the thin end of Module A (A1–A4, and P1's real board accounts). Building it here means building a people-admin surface inside the scoring demo, before a single board has signed anything, which is exactly the trade PRD §13 exists to refuse. The mitigation for the founding season is the one already written down: the founder runs the seed and keeps the output (PRD §12's white-glove), and `db:doctor` is the preflight that proves the links resolve before a call.

The honest summary is that **Module B can take a link away and cannot give one back**, and the asymmetry is load-bearing: killing a leaked credential is a security property the demo must have, while issuing one is a product Module A must have. They are not the same feature and they do not have to ship together.

### What this still does not build

Unchanged from ADR-0010, and repeated here so it stays visible: **a surviving tie cannot be resolved in the product** (the board gets a banner and no instrument, and the design question of what a hand-resolution *is* in an append-only model is unanswered), and **a deduction cannot be undone** (by invariant — the correction is another attributed deduction and a re-tabulation, which is fully expressible today).

Both of ADR-0010's other two gaps therefore stand. Its third is closed.
