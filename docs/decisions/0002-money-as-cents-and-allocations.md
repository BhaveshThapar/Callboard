# ADR-0002 — Money is integer cents, and payments allocate to charges

**Status:** accepted · July 9, 2026 · *schema designed, not migrated*

## Context

The product is being sold against a specific, documented failure. Mayuri's 2025–26 season-summary sheet records a net of **$2,837.47** beside a hand-typed note reading *"true amount around 8k."* The official ledger disagrees with reality by roughly $5,000, and the board knows.

Three mechanisms produce that gap (PRD §14):

1. **Card fees desync the books.** BU Dheem's $100 refundable deposit arrived as $97.01.
2. **Lump payments need hand-unbundling.** NCSU sent $2,160 labeled "hotel, security deposit & reg fees." Three obligations, one transfer.
3. **Every team owes a different total**, because the fee schedule is $70/dancer + $140/room + $100 deposit + late fees.

## Decision

**All monetary amounts are `integer` columns of cents.** Never `float`, never `numeric` read into a JavaScript `number` for arithmetic. Column names end in `_cents` so a violation is visible in a diff.

**`payments` stores three integers, not one:** `gross_cents`, `fee_cents`, `net_cents`. The team's obligation is settled by the gross. The org's bank shows the net. The difference is a recorded cost, not a hole.

**A payment never points at a charge.** `payment_allocations(payment_id, charge_id, amount_cents)` sits between them, so one payment can settle many obligations and one obligation can be settled by many payments. Invariant: `sum(allocations.amount_cents) <= payments.gross_cents`, with any remainder an unapplied credit.

**`payments.rail` records rails we do not route** — `venmo`, `zelle`, `check`, `cash` — because boards will keep taking money on them during the transition, and a ledger that cannot represent reality is a ledger nobody trusts.

## Consequences

BU Dheem's deposit becomes `gross 10000 / fee 299 / net 9701`. NCSU's lump becomes one `payments` row and three `payment_allocations` rows. Neither requires a human to reconcile, and PRD §13's "reconciliation error vs. bank: $0" becomes checkable.

Formatting for display is the only place a fractional dollar exists, and it happens at the edge.

## Not migrated

The money tables are specified in [DATA_MODEL.md](../DATA_MODEL.md) and absent from Postgres. PRD §8.1 says the model is defined now — it is, in prose and in a schema sketch. Migrating tables that no code reads would be dead code with a migration attached.

They land with Module A, behind the deposit gate in PRD §13. The decision recorded here is what Module A is required to build.
