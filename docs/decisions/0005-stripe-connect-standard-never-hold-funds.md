# ADR-0005 — Stripe Connect Standard; Callboard never holds funds

**Status:** accepted · July 9, 2026 · *designed, not implemented*

## Context

Money currently lands on Venmo (`@Maryland-Mayuri`) and is manually shuttled to an M&T bank account in nine transfers over a season, several at exactly $4,999 — structuring under an apparent cap. Zelle leaks alongside it, to the treasurer's *personal phone number*. (PRD §14.)

The buyer is a student org. Most are 501(c)(3)s; Mayuri's determination letter is on file. The treasurer turns over every May.

A platform that touches this money badly becomes a money transmitter, or muddies a nonprofit's books, or leaves a 21-year-old holding a frozen personal Venmo account.

## Decision

**Stripe Connect, Standard accounts.** Each comp connects its own Stripe account. Funds settle **directly to the org**. Callboard orchestrates charges and reconciles the ledger; it never sits in the flow of funds and never touches the org's tax status.

This is a prohibited surface, not a preference. It is stated in PRD §10 and it constrains every future payments decision.

Three consequences follow, and each is a product requirement rather than an implementation detail:

**ACH-first routing.** Under Connect Standard the processing fee is borne by the connected account — the comp. Team payments are bank-transfer-shaped lumps ($600–$2,160 at Mayuri 2026), not impulse checkouts. ACH is 0.8% capped at $5; anything over ~$625 hits the cap. Cards stay available for small items and last-minute payers. On an ~$11.5k season this is ~$60–80 instead of ~$250+.

**Nonprofit rate configuration.** 2.2% + $0.30 instead of 2.9% + $0.30, for orgs that qualify. Most do. Nobody has told them.

**Optional surcharge pass-through.** Per comp, the processing fee may be passed to the paying team, disclosed at checkout, within card-network rules (≤3%, US). This is the honest answer to *"won't we net less than we charge?"*

## Consequences

The platform fee cannot be a blanket 2%. Once payments are routed correctly, Stripe's own cut on an ~$11.5k season is ~$60–80; a 2% platform fee would be ~$230 — larger than Stripe's, reading to a treasurer as a 4%+ blended rake. That loses the deal.

So the **$300 flat fee per comp carries the revenue**, and the platform fee on payments is modest and card-volume-only, leaving ACH at cost. Blended platform take stays well under 1% of processed volume. This is why the PRD's earlier revenue ceiling was revised down and why the honest number is $8–12k/year across 20–25 comps.

**Standard, not Express or Custom.** Express would give a slicker onboarding and put Callboard closer to the funds. That proximity is the thing we are refusing. Standard means the org owns its Stripe dashboard, its payouts, and its 1099 — and it means the answer to *"what happens to our money if you disappear?"* is *"nothing, it was never ours."* For a student vendor with a credibility problem (PRD §12), that answer is worth more than a nicer onboarding flow.

## Not implemented

No Stripe code exists in this repo. The full spec is [PAYMENTS.md](../PAYMENTS.md); the ledger it writes to is [ADR-0002](0002-money-as-cents-and-allocations.md).

It is built when three founding partners commit (PRD §13), and not before. The founding season is free, so what lands is not money: a named person and comp date, their roster and fee schedule and last season's payment records, and a written $300 line in the 2027–28 budget. The first paid dollar arrives at Gate 2, in April 2027 — *after* this is built, which is the price of going free.
