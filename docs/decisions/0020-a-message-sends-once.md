# ADR-0020 — a message sends once, and the database is what says so

**Status:** accepted · August 2, 2026 · *migrated in `0013`*
**Related:** [ADR-0014](0014-the-allocation-counter.md), whose denormalized-counter bargain this repeats for a different reason; [ADR-0015](0015-a-refund-moves-the-money.md), whose append-only chain and terminal index this copies wholesale; [ADR-0012](0012-transactions-for-writes-that-span-statements.md), which this does **not** add a caller to.

## Context

C2 is the keystone the PRD names: *"dues reminders fire off payment status, schedule pushes fire off the Gita, 'you're up in 20' fires off show order."* Everything left on the map that has to reach a human goes through it — A10, A7's receipts, ADJ·2's feedback delivery, G5's push on change, and announcements.

It is also the first thing this product has ever built that **acts on the outside world.** Every write until now has been a row a board could correct: a wrong charge is voided, a wrong allocation is released, a wrong score is superseded by an attributed re-tabulation. A sent email cannot be voided. There is no `revoked_at` on somebody's inbox.

That changes what correctness means here. The money spine's hardest question was *is this number right*; this one's is *did this happen exactly once*. Those are not the same problem and the second is worse, because a duplicate is invisible from inside the system: two identical rows and one row look the same on every screen, and the only place the difference shows up is a treasurer's phone buzzing twice at 11pm with the same dues reminder — or eight times, if a cron retried.

The failure has a specific shape worth naming, because it is the one that will actually happen. A scheduled job claims work, sends, and dies before recording that it sent. The next run finds the same work unclaimed and sends again. Nothing is broken; nothing throws; the logs look fine.

## Decision

**A message is a row, its history is a chain, and a partial unique index is what makes a second send unrepresentable.** This is `deposit_events` applied to a smaller question, and deliberately so — the shape is already load-bearing here and a second shape would be a second thing to get right.

**`messages` is the outbox**, one row per intended message: recipient, channel, template, `payload json` (not `jsonb`, for `tab_runs`' reason — the bytes that went in are what a person was actually shown), and a `dedupe_key`.

**`unique(comp_id, dedupe_key)` is the whole guarantee.** A caller does not ask "have I sent this yet"; it inserts, and the database refuses the second. That is the same move as `payments_external_ref_unique` — *"a replayed webhook or a re-imported CSV is refused, not counted twice"* — and it works for the same reason: the check and the insert would otherwise be two acts on neon-http, and only one of them can be atomic.

The key is the caller's sentence about what this message *is*, not a hash of its contents: `dues:2027-02` rather than a digest of the body. A digest would make a reworded reminder a different message and send it again, which is exactly the bug.

**`message_events` is the chain**: `seq generatedAlwaysAsIdentity`, one row per transition, state is `max(seq)`'s row. `queued → sending → sent | failed | bounced`. `sent` and `bounced` are terminal; **`failed` is not**, for `refund_failed`'s reason — a timed-out SMTP connection is retryable, and calling it an ending would strand a dues reminder nobody can ever send. `messages_terminal_unique` is partial over the endings.

**`messages.state` is denormalized, and it is the claim.** This is ADR-0014's bargain made again with a different justification. The counter was denormalized because a cross-row sum cannot be a CHECK; this is denormalized because **a chain cannot be claimed atomically.** Appending a `sending` event does not stop a second worker appending one microseconds later, and a partial index over `sending` would block the retry that `failed` exists to allow. So the claim is one guarded statement:

```sql
UPDATE messages SET state = 'sending' WHERE id = $1 AND state = 'queued' RETURNING id
```

One atomic read-modify-write taking its own row lock — the shape `releaseAllocation` uses, and for the identical reason: **the guarded update is the serialization point**, and a worker that gets no row back sends nothing.

**The residual is the same one ADR-0014 accepted, and gets the same instrument.** The database enforces the terminal index and the unique key; it cannot enforce that `messages.state` agrees with `max(seq)` of its own events. So `db:doctor` reports the disagreement by id, exactly as it reports a drifting payment and a forked deposit. A message stuck in `sending` past a threshold is reported too, because that is precisely the crash-after-send footprint and it is the one state a human must look at rather than a machine retry.

**This is not a `withTransaction` caller.** The claim is one statement. The send is a network call that must happen *outside* any transaction — holding a pool open across an HTTP request to a mail provider is how a serverless function times out holding a lock. Recording the outcome is one insert plus one update. There is no invariant here spanning statements: a `sent` event with a stale `state` column is the drift the doctor reports, not a half-state a human cannot reconstruct, because the chain is the record and the column is a cache of it.

## Consequences

**A send that succeeds and then fails to record is reported, not repeated.** The message sits in `sending`, the doctor names it, and a human decides. That is deliberately worse ergonomics than an automatic retry and deliberately better behaviour: the alternative silently emails somebody twice, and this product's entire pitch is that it does not silently do things.

**Broadcast and transactional mail are separated at the schema**, because they have different consent rules and blurring them is how a product ends up sending marketing under a receipt's legal cover. `people.unsubscribed_at` suppresses broadcast and **does not** suppress a receipt or a dues reminder, which are things a board is entitled to send somebody who owes them money.

**Nothing sends in development or in tests.** The transport is chosen by environment and the default writes to a table instead of the network, so the e2e can assert that exactly one message was produced without a provider account and without the possibility of a test emailing a real person. That is not a mock — the outbox is the product, and only the last hop differs.

**A provider is a swap, not a rewrite.** `Transport` is an interface with one method; Resend is the first implementation. PRD §10 names SMS as well, and it arrives as a second transport behind the same outbox rather than as a second outbox — but it is **not** built here, because per-message cost and STOP/consent handling are a policy question for a board rather than a technical one, and PRD §12 already warns that comms is where this product is competing with a free incumbent.

**What this does not build:** no open tracking, no click tracking, no delivery analytics. A board does not need to know whether a captain opened an email, and building the surface that answers it means building the surface that leaks it.
