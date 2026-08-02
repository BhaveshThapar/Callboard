# ADR-0015 — A refund moves the money, and a deposit belongs to a team

**Status:** accepted · August 2, 2026 · *migrated in `0011`* · extends [ADR-0014](0014-the-allocation-counter.md)

## Context

[A7](../FEATURE_MAP.md) shipped on August 1, 2026 as an append-only `deposit_events` chain with a
terminal index, driven from the board's deposit table. It was reachable, attributed, and refused a
second ending. It was also, on inspection a day later, **a status label that moved no money.**

`advanceDeposit` wrote one event row and one audit row and touched nothing else. Nothing outside the
deposit table read the state — not `balance.ts`, not `who-owes.ts`, not either CSV. So after a board
returned a $100 deposit:

- the `deposit` charge was still live, so `owed` still counted it;
- `paid` was `sum(payments.gross_cents)`, so it still counted the $100 that had come in;
- the team read **settled**, and the org's books said the money was in the account.

The bank said otherwise. That is a reconciliation gap of precisely the kind PRD §13 promises to take
to **$0**, reintroduced by the feature written to close it — the same shape as A3's orphan and B6's
re-derived override, which is three times now.

Two smaller faults travelled with it, and they turn out to be one fault:

**A dropped team's deposit was unreachable.** `listDepositsForBoard` read `team.charges`, which the
roster window filters to `voided_at is null`. Dropping a team voids every charge it holds, so the row
left the screen at exactly the moment *forfeit or refund?* gets asked, and the action answered *"that
deposit is not one of this comp's."* The most consequential deposit in a comp was the one the product
could not act on.

**And "a deposit ends once" was true of a row rather than of a deposit.** The terminal index was
keyed on `charge_id`. `planCharges` voids and re-inserts a charge whenever its amount changes, so a
`depositCents` edit — or a drop and a reinstatement — minted a fresh id with an empty chain, and an
already-refunded deposit became refundable again. The index enforced exactly what it said and what it
said was the wrong noun.

## Decision

**A deposit's chain is keyed on `(comp_id, team_id)`.** `deposit_events.team_id` is the identity;
`charge_id` stays as nullable provenance and nothing resolves through it. A deposit is a fact about a
team, and the charge row is only what is currently carrying it.

**`refunded` moves the money. `forfeited` does not.** The asymmetry is the model:

| | obligation | money |
|---|---|---|
| `forfeited` | stays live — the team owed it and the org keeps it | untouched; every number is already right |
| `refunded` | voided, allocations released | `payments.refunded_cents` moves by what actually arrived |

So a refund drops `owed` and `paid` by the same amount, the balance does not move, and the cash
figure finally matches the bank.

**The outflow is `payments.refunded_cents`, not a negative row.** `CHECK (refunded_cents between 0
and gross_cents)`, and `paid` becomes `sum(gross_cents - refunded_cents)` — one definition, in
`listRosterForBoard`. Negative gross was never available: it would make `allocated_cents <=
gross_cents` uninterpretable, and that ceiling is the whole of ADR-0014. A `DELETE` was never
available either, for `voided_at`'s reason.

**A deposit nobody paid cannot be refunded**, refused when the refund is *started* rather than when
it completes — a board that reaches `refunded` has already told a team the money is coming.
Forfeiting an unpaid deposit stays legal: it is how a board records *this slot was held and never
paid for*.

**This is the third `withTransaction` caller**, and ADR-0012 asks for the argument to be made again
rather than inherited. The invariant is **a deposit's ending and the money it returns land
together**, and it spans four statements: the event, the void, the released allocations, the counter.
Its broken halves are both states a human has to find — a deposit marked `refunded` while the team
still reads as owing it, or an obligation quietly voided with nobody recorded as having decided
anything. The non-terminal moves keep their single statement, for the reason `setTeamStatus`'s fast
path used to exist: *this deposit is now pending* implies nothing else, and a transaction costs a
WebSocket handshake.

## Consequences

**A refund is now the only act in the product that reduces `paid`.** That is worth stating because it
makes `refunded_cents` load-bearing in the same way `allocated_cents` is: a second writer that moved
it without ending a deposit would produce a number nobody could explain. `db:doctor` reports a
payment whose `refunded_cents` exceeds what its team's deposit chain ever ended, for the reason it
reports allocation drift.

**A forfeited deposit leaves a live charge that will never be paid**, and that is correct rather than
tidy: the team owed it, and voiding it would erase the record of what the org kept. A treasurer
reading *owed $100, paid $100, forfeited* is reading the truth.

**This was decided without a founding partner**, and should read as one of those. Track 1 is 0/10 and
0/3, and nobody has told us what their board does with a deposit when a team drops in January. What
made it decidable anyway is that the alternative was not a different opinion but a wrong number: the
old behaviour claimed money was in an account it had left. The *policy* question — whether a dropped
team's deposit is refunded, forfeited, or partly both — is untouched here, and stays with the board,
which is why both endings are one click and neither is a default.

The **late fee's** open question is the sibling of that one and is still open: it lands on every
billable team once `lateAfter` passes, including one that paid in November.
