# ADR-0022 — a board link is exchanged for a cookie, and the URL becomes a place

**Status:** accepted · August 6, 2026 · *no migration; no new table and no new column*
**Related:** [ADR-0003](0003-judge-auth-via-signed-links.md), whose own unfinished hardening this is; [ADR-0011](0011-nothing-mints-a-link.md), which this does **not** violate — nothing here mints anything; [ADR-0016](0016-accounts-for-people-who-stay-links-for-people-who-visit.md), whose *"both models coexist"* is the shape this generalizes.

## Context

Callboard was a set of screens you reached by pasting a credential into the address bar. `/board/<token>/money` is a URL where the first segment is *who you are* and the rest is *what you want* — which works, and which is why every board screen, every form field, every `revalidatePath` and every line of `DEMO.md` carried a token through it.

Three things were wrong with that, and only the third was new.

**The credential lived in the address bar.** ADR-0003 accepted this for judges with a clear argument — a judge scores once, from a phone, and a bearer URL is worth its blast radius — and then named two hardenings it had not taken. The first was *"exchange the URL token for an `HttpOnly` cookie on first load and strip it from the address bar, so the credential stops living in history."* For a board member the argument is weaker than for a judge: a board link is not used once from a phone, it is used all season from a laptop that gets screen-shared to prospects, and it authorizes the lock, the override, the roster and the money.

**A board member with an account could not use it.** P1 built real accounts and memberships. `src/app/page.tsx` then told a signed-in board member, honestly, *"Board screens open from the link that was emailed to you, not from here"* — and named its own successor in a code comment: *"until P1 migrates board access onto accounts."* Two credentials existed for the same person and only one opened anything.

**And there was no product.** No home page that says what this is, no dashboard, no navigation — five board screens each rendering their own wordmark and their own ad-hoc links to whichever siblings their author remembered. That is how A9's dashboard shipped reachable only by typing the URL.

## Decision

**The URL names a place; a cookie says who you are.**

Screens move to `/app/[org]/[comp]/…`, mirroring the shape the public page already uses. `/board/<token>/…` becomes a **door**: an optional-catch-all route handler that resolves the token, sets an `HttpOnly` cookie holding it, and redirects to the same screen under `/app`. Every emailed link, every seeded link and every line of `DEMO.md` still lands where it always did.

It is a route handler rather than a page because Next 15 forbids a Server Component from setting a cookie, and setting one is the entire job.

**`resolveBoardAccess(compId)` is the one function that says a `BoardActor` has two origins.** It tries the account session first — `resolveSessionUser` then `membershipFor(personId, compId, "board")`, the shape `resolveLiaisonActor` already used — and falls back to the link cookie. Everything downstream takes the actor and cannot tell which it was, which is the property worth having: three windows, twenty writes and every `audit_log` row are unchanged.

**The session wins, deliberately.** It is the per-person, revocable, attributable credential and the one the product is moving toward; a stale cookie in a browser must not shadow the membership a board actually granted.

**The link path must prove the comp matches, and that is the whole security of this decision.** `membershipFor` is scoped by construction — it is asked about one `(person, comp, role)` and cannot answer about another. A token is not: `resolveBoardActor` resolves whatever assignment the token names, at whatever comp it belongs to. Without

```ts
if (actor.compId !== compId) return null;
```

a board member at one comp could hold their own entirely valid cookie and read another org's roster by editing the URL. It has its own test, and it is the reason this lives in one function rather than two resolvers being called side by side at forty-five call sites.

**Forms carry two fields, and they are not the same field.** `compId` is the authorization subject; `basePath` is display only, so an action can `revalidatePath` the right entry. One string doing both jobs would be trusted for the second reason on the day somebody needed it for the first.

## Consequences

**Nothing is minted and nothing is invalidated.** ADR-0011's rule stands: a seed is still the only thing that issues a board link. The door exchanges a credential it was handed for a shorter-lived carrier of the *same* authority, over the same `board_assignments` row, killed by the same `revoked_at`. The cookie holds the raw token rather than an identity, so there is nothing in it to outlive the grant — a revoked link is dead on the next request, cookie or no cookie.

**The credential stops being re-transmitted.** It is no longer in the address bar, the history, the referer of every outbound link, or a screenshot of the demo. The polling endpoint stops being a bearer URL written to a server log every two seconds for the length of a comp.

**A board member with an account no longer needs the link at all**, which is what makes the dashboard true rather than decorative. Both ways in coexist, which is exactly what ADR-0016 did for accounts and links in the first place.

**What this costs.** A cookie is not scoped to a path, so one board link is live for one browser at a time; somebody holding links for two comps re-opens the second one. That is what they do today anyway, and the alternative — a cookie per comp — accumulates in a browser forever for a case nobody has yet. Twelve hours of `maxAge` covers a comp day and expires before the next one.

**And a real asymmetry, named rather than hidden.** A link-holder has no account, so there is nothing to sign out of; the shell says *via board link* where it would otherwise offer *Sign out*. Offering one would either do nothing or, worse, look like it revoked the link.

**B10 is deliberately untouched.** Board revocation still refuses the last live link, even though an account is now another way in and a board with accounts could survive losing all of them. Relaxing that needs its own argument, and burying it inside a routing change is how a safety rail quietly stops being one.

## When this changes

If board links ever stop being how a comp is set up — that is, if `db:seed` grows accounts and P2's setup UI arrives — the door becomes a compatibility shim for links already in inboxes, and can be dated and removed. It should not be removed before then: today the seed mints links and no accounts at all, so the door is the *only* way a founding partner's board gets in.
