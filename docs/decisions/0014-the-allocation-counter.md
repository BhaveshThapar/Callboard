# ADR-0014 — The allocation counter, and where a money invariant lives

**Status:** accepted · July 31, 2026 · *supersedes ADR-0002's "Not migrated" section*

## Context

[ADR-0002](0002-money-as-cents-and-allocations.md) states the invariant that makes the unbundler safe:

> `sum(allocations.amount_cents) <= payments.gross_cents`, with any remainder an unapplied credit.

It does not say what enforces it, because at the time nothing did — the tables were prose. They are being built now, and the question has to be answered before the first row exists, because it is not a thing that can be retrofitted onto a table with money in it.

The invariant **spans rows**. A `CHECK` constraint sees one row and cannot express it. So there are three candidates, and the repo has already rejected the shape of two of them for other reasons.

**A trigger** is the strongest option and would be correct. It is refused on three counts, none of them about correctness: drizzle-kit does not generate triggers, so it would live in a hand-written migration that `src/db/schema/` does not describe; PL/pgSQL is a language nothing else in this repo speaks; and the invariant would be **invisible in the one file a contributor reads to learn what is true**. A guarantee nobody can find is one the next person writes around.

**An application check inside a transaction** — read the allocations, sum them, refuse — is refused on [ADR-0012](0012-transactions-for-writes-that-span-statements.md)'s own recorded grounds:

> A transaction only protects the code that remembers. The database is the only thing that can actually refuse.

That sentence was written about the run chain, and it applies here unchanged. A seed script, a hand-typed `INSERT` during a support call, or a second write path added in six months does not remember.

## Decision

**A denormalized `payments.allocated_cents`, with `CHECK (allocated_cents <= gross_cents)`, moved only by `UPDATE payments SET allocated_cents = allocated_cents + $n WHERE id = $1`.**

That statement is a single atomic read-modify-write. It takes its own row lock, so two allocators racing the same payment serialize rather than both reading the same stale sum, and the `CHECK` fires **inside the same statement** that moved the number. Over-allocation becomes *unrepresentable* rather than *caught* — the same property `tab_runs_root_unique` gives the run chain, achieved the same way: by asking the database to refuse a state instead of asking the code to avoid one.

Three more refusals live beside it, each because the alternative silently produces a wrong number rather than an error.

**`voided_at`, never `DELETE`.** Deleting a charge that has money against it destroys the record of what a payment was *for*. Voiding gets the hard case right: a team that paid $1,120 and then dropped reads `owed 0 / paid 1120 / balance −1120` — the org owes them, stated in the product, rather than discovered in April.

**`amount_cents > 0`, never negative.** A revision is a void plus an insert. Two mechanisms for "owes less than we said" is one too many, and the negative one is what makes a `sum()` report quietly right-looking and wrong.

**`net_identity` is a `CHECK`, not a generated column.** A generated column *supplies* the right answer, so a bank import claiming `net 9701` where `gross - fee` says `9702` imports cleanly and the disagreement disappears. The ~$5,000 gap in PRD §14 is made entirely of discrepancies nobody was shown. A refused import is a discrepancy someone is shown.

**The names have one definition**, `MONEY_CONSTRAINTS` in `src/db/schema/money.ts`, for `CHAIN_INDEXES`' reason ([scores.ts](../../src/db/schema/scores.ts)): three places must agree on strings none of them can derive — the schema that declares them, the write path that reads one off a failed insert's `cause` to turn it into a sentence a treasurer can act on, and `db:doctor`, which looks them up to prove the guarantee is live on the database in front of it rather than merely intended.

## Consequences

**The residual is named, not hidden.** The database enforces `allocated_cents <= gross_cents`. It does **not** enforce `allocated_cents = sum(live allocations)`. Those come apart if a row is written by anything that skips the counter.

This is deliberate, and it is the same bargain the run chain already makes. A forked chain is refused by an index; a chain that somehow forked anyway is *found by `db:doctor` and reported by id*, because the code may not assume the database is in the state the code intends. So `db:doctor` gains the same treatment for money: it reports payments whose counter disagrees with the sum of their live allocations, by id. A disagreement is detectable, and therefore repairable, which is the whole difference between this and a number that is simply wrong.

**A payment carries a number that is not derived on read**, which is the ordinary cost of denormalization and is accepted for the ordinary reason: the derived-on-read version cannot be constrained, and this one can.

**`refusal()` becomes the third reader of `violatedConstraint`** ([errors.ts](../../src/db/errors.ts)), meaning a third thing by it. `lockAction` reads a chain index as a **refusal** — there must not be a second root. `apply` reads `teams_comp_bid_code_unique` as a **retry** — the applicant did nothing wrong. The ledger reads a money constraint as **a sentence for a treasurer**, which is why the counter is moved *before* the allocation row is inserted: it decides that the constraint firing on a race is `payments_allocated_check`, and therefore decides which sentence the person sees.

## What this does not decide

**Whether Callboard routes money.** Nothing here is Stripe. Every table, constraint and code path added under this decision works on a hand-entered `rail: 'venmo'` row, which is what ADR-0012 already conceded and what [PAYMENTS.md](../PAYMENTS.md) already says. The ~$5,000 gap is closed by the ledger, not by routing. [ADR-0005](0005-stripe-connect-standard-never-hold-funds.md) stays *designed, not implemented*, and the question it defers — whether a student board wants card rails at all — stays where PAYMENTS.md put it: with the founding partners.
