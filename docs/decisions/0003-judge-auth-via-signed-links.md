# ADR-0003 — Judges authenticate by signed link, never by account

**Status:** accepted · July 9, 2026 · the board-link half superseded by [ADR-0007](0007-board-links-are-per-person.md) · *only the hash is stored* narrowed by [ADR-0021](0021-the-outbox-holds-a-secret-only-until-it-sends.md)

## Context

PRD §8.2 B2: *"Judges score from any browser on a phone — no app install."*

Judges are volunteers, often alumni, often meeting the host org for the first time that morning. They are handed a clipboard today. Any flow with a password reset, an email round-trip, or an app store is a flow that fails in a loud venue with bad wifi twenty minutes before doors.

The board needs protection too. The demo lives on a public URL, and the lock button is destructive-ish: anyone who could reach it could freeze results mid-comp.

## Decision

The credential is the URL.

- `judge_assignments.token_hash` stores the sha256 of a 32-byte random token. The raw token exists only in the link handed to the judge.

  > **Narrowed by [ADR-0021](0021-the-outbox-holds-a-secret-only-until-it-sends.md), August 5, 2026.** This still holds of every table that *authorizes* — judge links, board links, and `invitations` itself. It does not hold of the outbox: an invitation that emails itself has to be held somewhere between being queued and being sent, so the raw link lives in `messages.payload` for one cron interval and is stripped when the message reaches `sent`. "We never store a raw token" is exactly the kind of sentence that gets repeated after it has stopped being true, so it is corrected here rather than only there.

- `comps.board_token_hash` uses the identical primitive, one per comp, authorizing the tab view, deductions, and the lock.
- Resolving a token is an indexed lookup on its hash. Revoking a judge is `update judge_assignments set revoked_at = now()`.
- `src/lib/auth/token.ts` is the only place tokens are minted or hashed.

No passwords. No sessions. No user table with credentials in it.

## Consequences

**Good.** A judge link can be texted. It works on any phone, first tap, no install. A leaked link dies in one statement. The board gets the same guarantee for free, from the same code path. There is nothing to reset at 8am on comp day.

**The cost.** A URL is a bearer token: anyone holding it is that judge. It will end up in browser history, in a group chat, and in someone's screenshot. Tokens are 32 bytes of `randomBytes`, so guessing is not the threat — sharing is.

We accept this, because the alternative costs more than it buys. The blast radius of a leaked judge link is one judge's scores at one comp, every write is attributed in `audit_log`, and the link is revocable in a second. Compare that to the blast radius of a judge who cannot log in while eight teams wait.

## When this changes

Module A introduces real board accounts, because it introduces money and a roster of real people's contact information — things worth protecting beyond one comp's scores. Judge links stay exactly as they are, forever. They are not a shortcut; they are the right answer for a volunteer holding a phone.

Two hardening steps we did not take, and would take before charging for this:

- Exchange the URL token for an `HttpOnly` cookie on first load and strip it from the address bar, so the credential stops living in history.
- Scope judge links to the comp's date window.
