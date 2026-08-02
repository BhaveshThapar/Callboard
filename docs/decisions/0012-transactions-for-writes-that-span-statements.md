# ADR-0012 — a second driver for writes whose invariant spans two statements

**Status:** accepted · July 12, 2026
**Related:** [ADR-0001](0001-stack.md), which chose neon-http; [ADR-0010](0010-a-comp-is-one-division.md), whose chain indexes exist *because* neon-http has no transactions and which this does not undo.

## Context

Module A's second feature is a waitlist promotion, and the way it is specified in [`FEATURE_MAP.md`](../FEATURE_MAP.md) (A2) and [`PAYMENTS.md`](../PAYMENTS.md) names the requirement outright: a drop and a promotion "update balances and slots together", **in the same transaction**.

`src/db/index.ts` is `drizzle-orm/neon-http`. It sends one HTTP request per statement and holds no session, so it has **no transactions at all**. This is not a footnote — it is the single most load-bearing fact in the codebase. `lockResults` reads `latestLockedRun` and then inserts, and those are two acts with a gap between them; two board members can land in that gap and produce two locked results. The fix was not to reach for a transaction, it was `tab_runs_root_unique`, a partial unique index that makes the second root *unrepresentable*. That is a stronger guarantee than a transaction: it holds for code that forgets to open one.

So Module A arrives at a fork. Either every multi-statement invariant gets the `tab_runs` treatment — expressed as a constraint the database enforces — or the stack gets a way to open a transaction.

The chain-index treatment does not generalize. It works for the run chain because "one root per comp" is a *shape* a unique index can describe. "Promoting this team off the waitlist and marking that team dropped either both happen or neither does" is not a shape; it is a sequence. There is no index that says it.

## Decision

**Add a transaction-capable driver, keep neon-http as the default, and make the boundary explicit.**

`@neondatabase/serverless` already exports a WebSocket `Pool`, and `drizzle-orm/neon-serverless` opens real transactions over it. **No new dependency.** Verified against the `dev` branch before this was written: a throwing callback rolls back, a returning one commits.

The surface is one function, not a second `db`:

```ts
export const withTransaction = async <T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
```

A function rather than an exported handle, because an exported `dbTx` would be indistinguishable from `db` at the call site and would become the default by drift — someone would import it for a read, and the reason for the two would be lost within a month. `withTransaction` can only be used the way it is meant to be used, and it names itself in every diff that adds one.

It builds a pool per call and tears it down in a `finally`. That costs a WebSocket handshake, which is the point: it is expensive enough to stay rare. A module-level pool would be cheaper and wrong — these run in serverless functions that are frozen and thawed between invocations, and a pool held across that boundary hands out sockets the platform already closed.

## Consequences

**The chain indexes stay, and `lockResults` stays on neon-http.** This is the part most likely to be got wrong later, so it is written down: the correct response to "we have transactions now" is *not* to rewrite the lock path around one. `tab_runs_root_unique` refuses a fork from code that never opens a transaction, from a seed script, from a hand-typed `INSERT`, and from a future path that forgets. A transaction only protects the code that remembers. The database is the only thing that can actually refuse, and it should stay the thing that does.

**Reads and single-statement writes stay on `db`.** Every existing path is one of those, so nothing migrates. The first caller of `withTransaction` will be A2.

**Two drivers means two connection paths**, and a failure mode where one works and the other does not — a WebSocket blocked by a network that permits HTTPS, most plausibly. It is a real cost. It buys the only thing that can make a promotion atomic, and Module A does not ship without it.

### What this deliberately does not settle

**Whether Callboard routes money at all.** A2's transaction requirement is usually motivated by "slots *and balances*", and balances imply `charges`, which imply the payments stack. That stack is still unbuilt and, on inspection, may not be the right first move: the ~$5,000 reconciliation gap of PRD §14 is closed by the *ledger* — `charges`, `payments`, `payment_allocations`, roster joined to money — and [`PAYMENTS.md`](../PAYMENTS.md) already concedes that a hand-entered Venmo payment (`payments.rail = 'venmo'`) reconciles through that ledger perfectly well. Stripe buys automatic ingestion, a `fee_cents` known at the moment of payment rather than discovered on a March bank statement, and — the part that is not a fee question at all — money that settles to the org rather than sitting in a student treasurer's personal account.

Whether that is worth the Connect onboarding a student board has to complete in September is a question for the three founding partners, not for this document. The gate already asks them for last season's payment records, which is exactly the evidence that would answer it. So `withTransaction` is justified here on the *roster* invariant alone — a promotion and a drop moving together — which holds whether or not a single cent ever flows through Stripe.

**Update, July 31, 2026.** The question above split, and only half of it was answered. The **ledger** was authorized and is being built — `charges`, `payments`, `payment_allocations`, roster joined to money — on hand-entered `rail: 'venmo'` rows, exactly as this section describes them working. **Routing was not.** ADR-0005 stays *designed, not implemented*, and the founding partners' question is unchanged, because building the ledger is what makes that question answerable with their data instead of with a guess.

One consequence lands here directly: [ADR-0014](0014-the-allocation-counter.md) adds the **second and last sanctioned `withTransaction` caller**, the ledger, where a payment row, its allocations and the counter that constrains them are one act. Naming it here in advance is the point — the property this ADR asked for was that a transaction be rare and visible in every diff, and a caller that arrives by argument keeps that property in a way one that arrives by convenience does not. `setTeamStatus` also grows: a drop must void what a team owed, and a promotion must generate what the promoted team now owes, in the same act that moves the slot. That is the same invariant this ADR already justified, with the balances half finally present.

**What was not foreseen here: `setTeamStatus`'s non-transactional path did not survive.** This ADR justified the transaction on the promotion alone, and deliberately left the ordinary move — the one that promotes nobody — as a single statement, because one statement is atomic on neon-http without asking for anything. Obligations end that. `applied → accepted` became *"accepted **and** owing what the schedule says"*, an invariant spanning two statements whose broken half is an accepted team owing nothing — the orphan A3 exists to prevent, found in March by a treasurer rather than in September by us. So the fast path collapsed in, and every roster move now opens a pool.

The guards stay **outside** the transaction — the lock check and the claim check reject without a handshake — which preserves what this ADR was actually protecting: the cost is paid only by writes that need it, not by writes that are refused.

**Update, August 2026 — a third call site, and still two callers.** `allocatePayment` opens a transaction. It is *not* a third caller, and the distinction matters enough to write down rather than leave to a `grep` that counts three.

This ADR named its unit as **the ledger** — "a payment row, its allocations and the counter that constrains them are one act" — not as a function. `allocatePayment` writes exactly that invariant and no other: `applyAllocations` moves the counter and inserts the row, and the broken half is either a counter claiming money is spent against nothing, or an allocation with no counter behind it. That is precisely the drift [`db:doctor`](../../src/db/doctor.ts) reports by id, which is to say it is the state ADR-0014 accepted as a named residual and built an instrument to find. Same module, same invariant, same two statements, second caller.

Why it had to exist at all: `recordPayment` consumed its allocations inside the transaction that created the payment, so the set was fixed at insert and permanent. Two ordinary sequences put money where nothing could ever attribute it — a team pays a deposit to hold a slot while still `applied`, where `BILLABLE_STATUSES` means it has no charges and every allocation is refused; or a roster size changes and `syncCharges` voids and re-inserts, leaving the allocation pointing at a row nobody can see. Neither is an edge case, and neither is fixed by a better entry form.

The ordering rule now has one definition. `applyAllocations` was extracted from `recordPayment` rather than copied, so *counter first, then row* is written once — a future caller cannot reverse it, and therefore cannot change which constraint fires on a race and which sentence a treasurer reads.

**Update, August 2, 2026 — two more call sites, and still two callers.** `setTeamBilling` and `regenerateCharges` open transactions. Both belong to the roster caller this ADR justified in its first update, and the argument has to be made rather than assumed, because "it also writes charges" is exactly the reasoning that would turn a rare instrument into the default.

The roster caller's invariant was never "a promotion and a drop". It is **a roster fact and the obligations it implies land together** — which is why the fast path collapsed when `applied → accepted` became *"accepted and owing what the schedule says"*. `setTeamBilling` writes the same sentence about two more facts: a team's dancer count and its room count are what it is billed *on*, so *"sixteen dancers and four rooms"* and *"and therefore owing $1,780"* are one act. The broken half is the same orphan wearing different clothes — a team recorded as having four rooms and billed for none, found in April.

`regenerateCharges` is the comp-wide form of it: the roster's stated facts and the charges the schedule derives from them, brought into agreement in one act. Its half-applied state is a comp where some teams carry a late fee and others do not, with nothing on the screen to say which half ran — and a treasurer cannot tell that apart from a schedule they misremember.

What would *not* qualify, stated so the line stays somewhere: a write that merely touches several tables, or one whose halves are independently sensible. `setWaitlistRank` writes many rows and opens nothing, because its rewrites are one `case` expression and one statement is atomic without asking. That is still the test.

**Update, August 2, 2026 (later) — a third *caller*, argued rather than assumed.** `advanceDeposit` opens a transaction for the `refunded` transition, and this one is genuinely not the roster's or the ledger's. It is the third, and it is the first since this ADR was written that had to earn the name rather than inherit it.

Its invariant is **a deposit's ending and the money it returns land together** ([ADR-0015](0015-a-refund-moves-the-money.md)). That spans four statements — the terminal event, the void of the deposit charge, the release of its allocations, and the counter behind them — and the halves are the shape this ADR exists for: a deposit recorded as `refunded` while the team still reads as owing it, or an obligation quietly voided with no event saying anybody decided to return anything. Neither is detectable from the screen, and both are found by a treasurer.

It is not the ledger's caller, though it moves `payments.refunded_cents`, because the ledger's unit is *a payment row, its allocations and the counter that constrains them*, and this writes none of that: it ends a deposit and the money follows. It is not the roster's either — nothing about the roster changes, and a refund is available to a team that dropped months ago.

**The non-terminal moves deliberately stay on `db`.** `held → refund_pending`, `refund_pending → refund_failed`, `refund_failed → held` are one INSERT and one audit row, and *this deposit is now pending* implies nothing else that has to be true at the same moment. Splitting the function by whether the transition moves money — rather than opening a pool for every click — is the same call the first update recorded losing on `setTeamStatus`, made the other way, and it is available here only because the states differ in what they imply rather than in how much they write.

The count is now **three**, and `grep` finds seven call sites. That gap is the point of counting by invariant, and it is also the reason to keep writing these updates: a fourth needs this argument made again, in these terms.

**Update, August 2, 2026 (P1) — a fourth caller: accepting an invitation.** `acceptInvitation` opens a transaction, and this ADR asks for the argument rather than inheritance, so here it is.

The invariant is **an invitation is spent exactly when the authority it grants exists** ([ADR-0016](0016-accounts-for-people-who-stay-links-for-people-who-visit.md)). It spans three statements — mark the invitation accepted, create or find the user, grant the membership — and both broken halves are states a human has to find and neither is visible from a screen. An envelope marked spent that granted nothing locks somebody out of a comp holding a link that will never work again. A membership with no account behind it is authority attached to nobody, which the board will read as *"they have access"* and the person will experience as *"it says my email is wrong."*

It is not the roster's caller, though it writes a row about a person at a comp: the roster's unit is *a roster fact and the obligations it implies*, and this implies no obligation and moves no money. It is not the ledger's, which is about a payment and its allocations. It is not the deposit's. It is a fourth, and the count is now **four** while `grep` finds eight call sites.

**The guarded update is the serialization point**, the way it is in `releaseAllocation`: the `UPDATE ... WHERE accepted_at IS NULL ... RETURNING` decides which of two racing clicks spent the invitation, and a loser spends nothing and grants nothing. The session is deliberately created *outside* the transaction — handing out a cookie is not part of the invariant, and a failure there is somebody clicking "sign in", not a broken grant.

**What did not qualify, so the line stays somewhere:** `signIn` writes a session row and updates `last_login_at` and opens nothing, because a `last_login_at` that failed to update is a cosmetic loss. `invite` revokes the previous envelope and inserts a new one and opens nothing either — the partial unique index is what actually refuses a second live invitation, and an index refuses it from a hand-typed `INSERT` too, which is the `tab_runs` argument.
