# Payments

**Status: the ledger is built; routing is not.** The obligation half of this document — `fee_schedules`, `charges`, `payments`, `payment_allocations`, and the reconciliation they make possible — landed in migration `0009` on July 31, 2026, with the deposit chain in `0010` and the refund half in `0011` ([ADR-0015](decisions/0015-a-refund-moves-the-money.md)). **No Stripe code exists in this repo, and none is authorized** ([ADR-0005](decisions/0005-stripe-connect-standard-never-hold-funds.md) stays *designed, not implemented*).

That split is the whole point and it is not a compromise: the ~$5,000 gap this document exists to close is closed by the **ledger**, on hand-entered `rail: 'venmo'` rows. Stripe buys ingestion and a `fee_cents` known at payment time rather than discovered on a March statement. Useful, and not the thing that was broken.

This document is the spec Module A builds against, and the argument a treasurer has to be able to check.

Sources: PRD §8.2 (A5–A11), §10, §11, §14.

## The prohibited surface

Callboard **never holds funds** and **never touches the org's tax status.**

That is a product constraint, not a preference. The buyer is a student org, most of them 501(c)(3)s — Mayuri's determination letter is on file. A platform that becomes a money transmitter or that muddies a nonprofit's books is unsellable to a treasurer and a liability to us.

Concretely: **Stripe Connect with Standard accounts.** Each comp connects its own Stripe account. Funds settle directly to the org. The org owns the relationship, the payouts, and the 1099. Callboard orchestrates and reconciles.

## Fee incidence is a first-class concern

Under Connect Standard, Stripe's processing fee is borne by the connected account — the comp. So how the money is routed determines what the comp keeps, and getting this wrong is how the pricing model dies.

### ACH-first routing (A5a)

Team payments are bank-transfer-shaped lumps, not impulse checkouts. Mayuri 2026's ranged from roughly $600 to $2,160.

- **ACH**: 0.8%, capped at $5. Anything above ~$625 hits the cap.
- **Card**: 2.9% + $0.30, or 2.2% + $0.30 at the verified-nonprofit rate.

Route registration and hotel payments over ACH by default; keep cards available for small items and last-minute payers. On Mayuri's ~$11.5k season this is the difference between **~$250+ all-card and roughly $60–80**.

### Nonprofit rate (A5b)

Support the verified-nonprofit card rate in connected-account setup. Most host orgs qualify; nobody has told them.

### Optional surcharge pass-through (A5c)

Per comp, allow the processing fee to be passed to the paying team, disclosed at checkout, within card-network surcharge rules (≤3% in the US).

This is the honest answer to *"won't we net less than we charge?"* — the comp can net exactly what it charges. The paying dancer sees a "processing fee" line, as they already do everywhere else. Default is configurable.

## Why the platform fee is not 2%

Once payments are done right, Stripe's own cut on an ~$11.5k season is ~$60–80. A blanket 2% platform fee would be ~$230 — **larger than Stripe's**, and it reads to a treasurer as a ~4%+ blended rake. That loses the deal.

So: **$300 flat per comp** carries the revenue. The platform fee on payments is modest and **card-volume-only**, leaving ACH at cost, because ACH is where the big lumps go. Target blended platform take well under 1% of processed volume.

**For founding partners the first season is free.** $0 for the Jan–Mar 2027 season, Module A included; $300 flat from 2027–28, locked. The price is named and then waived — it is not that there is no price (PRD §11).

So the comp's incremental cost against today's "free" Venmo, in the founding season, is **under $100 of processing it can pass through to teams anyway** — against elimination of a ~$5,000 reconciliation gap and the risk of a personal Venmo account being frozen. From the second season, add the flat $300.

## The ledger

The reason this document exists is that the current system's ledger disagrees with reality by about $5,000, and the board knows it (PRD §14).

Three failures produce that gap, and each has a schema answer in [DATA_MODEL.md](DATA_MODEL.md).

**1. Card fees silently desync the books.**
BU Dheem's $100 deposit arrived as $97.01. `payments` therefore stores three integers, not one:

```
gross_cents = 10000    what the team paid; settles their obligation
fee_cents   =   299    the org's cost; a recorded line, not a hole
net_cents   =  9701    what the bank shows
```

**2. Lump payments must be unbundled by hand.**
NCSU sent $2,160 labeled "hotel, security deposit & reg fees." That is one `payments` row and three `payment_allocations` rows. The allocation table is the unbundler; the invariant is `sum(allocations) <= gross_cents`, with any remainder an unapplied credit.

**3. Roster churn orphans obligations.**
Two accepted teams dropped and two waitlisted teams were promoted between December and February. Because roster and payment status live in one record (A3), promoting a waitlisted team reconciles slots and balances in the same transaction (A2), instead of leaving the acceptances doc and the Venmo history to disagree forever.

**Every amount is an `integer` of cents.** A float anywhere in this pipeline reproduces the bug we are selling against. See [ADR-0002](decisions/0002-money-as-cents-and-allocations.md).

## Rails we record but do not route

`payments.rail` includes `venmo`, `zelle`, `check`, and `cash`. Boards will keep taking money on those rails during the transition, and a ledger that cannot represent reality is a ledger nobody trusts. Recording a Venmo payment is a manual entry; it still allocates to charges, and it still reconciles.

What we do not do is move money over them.

## Refunds

Deposits are refundable, so `charges.kind = 'deposit'` needs a clean state machine. ACH refunds and card refunds differ in timing and in which fees are retained; the ledger must reflect what actually came back, not what was requested.

## Migration on-ramp

**Google Drive import (A11)**, one-directional, onboarding only. Point Callboard at an existing comp folder; ingest the roster and the prior-year Gita. This kills the "we already have everything in Sheets" objection.

Drive is the on-ramp. It is never the backend.
