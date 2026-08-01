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
