# ADR-0005 — Stripe Connect Standard; Callboard never holds funds

**Status:** accepted · July 9, 2026 · **implemented August 18, 2026, at the founder's direction and ahead of the gate**

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

## Implemented — August 18, 2026

**This said "not implemented" and that it would be built "when three founding partners commit (PRD §13), and not before."** Track 1 is still **0/10 conversations and 0/3 signatures**. It was built anyway, at the founder's direction, and that is recorded here rather than tidied away — the same way `FEATURE_MAP.md` records every other crossing of its own line.

What the decision above bought, now that there is code under it:

- **Standard accounts.** `createConnectedAccount` passes `type: "standard"`. Funds settle to the org; the org owns the dashboard, the payouts and the 1099. Callboard's secret authorizes the call and never receives the money, and Stripe hosts the onboarding form — so this product never sees a bank number, a tax id or a date of birth.
- **ACH-first (A5a).** `defaultRail` sends a lump over ACH and leaves a small item on card. The cap is the point: 0.8% capped at $5 means a $2,160 payment costs five dollars rather than $62.94. Asserted against Mayuri's own shape — ten lumps come to under $80 ACH-first against over $290 all-card.
- **Nonprofit rate (A5b).** Stated by the board, never detected: whether Stripe has *verified* the status is a fact about their dashboard, and guessing would quote a fee the statement then disagrees with.
- **Surcharge (A5c), capped at 3%** in the arithmetic **and** by a CHECK. A comp that set 4% would get no warning from Stripe — it would get a card-network rule violation, months later, aimed at the org.

**One thing the spec promised that the arithmetic will not.** A5c cannot make an org whole on a card. 2.9% + 30¢ on $100 is $3.29 once grossed up, and the 3% cap permits recovering only $3.00 — the org is **29¢ short**. `planSurcharge` returns `netCents` stating that rather than rounding it away, because "you net exactly what you charge" with an unshown gap is PRD §14's own species in miniature.

**And the fee is not derived.** `payments.fee_cents` is still recorded per payment, and the webhook writes `0` until the real figure arrives: Stripe's fee lives on the balance transaction and is not final when the intent succeeds. Guessing it from the rate card would put a number in the ledger that the March statement disagrees with — which is exactly what the gross/fee/net split exists to make visible.

The full spec is [PAYMENTS.md](../PAYMENTS.md); the ledger it writes to is [ADR-0002](0002-money-as-cents-and-allocations.md). **The question this ADR reserved for founding partners — whether a student board wants card rails at all — is still unanswered**, and building the rails did not answer it.
