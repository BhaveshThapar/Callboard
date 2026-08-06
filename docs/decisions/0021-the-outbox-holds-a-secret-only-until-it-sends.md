# ADR-0021 — the outbox holds a secret only until it sends

**Status:** accepted · August 5, 2026 · *no migration; the column already exists*
**Related:** [ADR-0003](0003-judge-auth-via-signed-links.md), whose *only the hash is stored* rule this narrows rather than keeps; [ADR-0016](0016-accounts-for-people-who-stay-links-for-people-who-visit.md), which built the invitation this is about; [ADR-0020](0020-a-message-sends-once.md), whose payload-is-the-bytes-that-went-in property this trades against for exactly one template.

## Context

An invitation used to be copied off a screen by hand. Now it sends itself, and that is the whole of the change — but it moves a credential into a table.

ADR-0003's rule is one sentence: *the raw token exists only in the link handed to the judge*, and the database holds a sha256. ADR-0016 inherited that primitive wholesale for invitations, and the People screen was careful about it — the link is shown exactly once and the product cannot recover it, which is why the screen still shows it even when an email is going out.

**Emailing a link cannot honour that rule.** The outbox is an outbox: a message is queued now and sent by a cron tick later, so between those two moments something has to hold the thing that is going to be sent. There is no version of "the engine mails the link" where the link is not, for some interval, a row in `messages.payload`.

So the question is not whether to store it. It is **how long**, and what a read-only leak of that table is worth.

Before this feature, the answer was clean: `invitations.token_hash` is a hash, and somebody who could read every table in the database held no working credential. After it, they hold **every unspent invitation** — which is to say, the ability to become any person a board has invited and not yet onboarded.

That is bounded, and the bounds are real rather than consoling:

- An invitation **names who it is for before it is accepted** (ADR-0016), so a stolen one grants exactly that person's role at that comp. It cannot make the holder somebody else, and it cannot be pointed at a different comp.
- It is **single use** — `invitations_live_unique` is partial over the unspent rows, and accepting spends it in the same transaction that creates the membership.
- It **expires in fourteen days**.
- A membership can be **revoked**, and revoking kills any unspent envelope behind it.

Against that: the window is not fourteen days. It is *until somebody reads the table*, and the rows accumulate. A comp that has invited forty people over a season has forty of them, most long since accepted and therefore harmless — but the harmless ones are indistinguishable from the live ones without checking, and the table keeps them all forever.

## Decision

**The payload stops carrying the link the moment the message is sent.**

`SCRUBBED_FIELDS` in `src/lib/comms/render.ts` names which fields of which template hold something that must not outlive the send. It has exactly one entry, `"invitation.created": ["url"]`, and it lives beside `TEMPLATE_KIND` because *this payload carries a secret* is a fact about the template. A template added later with a credential in it is one line there; a template added later with a credential in it and nothing there is the leak, and that list is the one place a reader would look for it.

**Replaced, not deleted.** The key survives with the value `(link removed after sending)`. Deleting it would leave the stored row failing its own payload type, so replaying it a season later renders `undefined` into a sentence somebody supposedly read. This way the record answers the question honestly: there was a link here, it went out, it is gone.

**On `sent` only.** Not `bounced` — that invitation was never delivered, and stripping it destroys the last copy of a link nobody received. Not `failed` — that one is retryable by definition and the next attempt has to be able to send the same thing. `sent` is the one state where the payload has finished its job.

**It rides the `UPDATE` that moves the state**, through `advance`'s existing `extra`, rather than being a second statement. So there is no window in which a message reads `sent` with the link still in it, and no new failure mode: the send has already happened and nothing here can un-happen it.

## Consequences

**What this buys.** The exposure stops being *every unspent invitation in the table* and becomes *every invitation queued and not yet swept* — which is one cron interval, five minutes, and in practice the handful of rows a board created in the last few minutes. A read-only leak of an old database now yields what it yielded before this feature: nothing that opens anything.

**What it costs, and it is a real cost.** ADR-0020 chose `json` over `jsonb` specifically so a payload could promise back the bytes that went in — *"what a person was actually told is exactly the kind of thing somebody asks about a season later."* For this one template that promise is now weaker: the stored payload reproduces the subject, the sender, the role and the wording, and does not reproduce the link. That is the right trade only because of what the missing field is. Nobody asks *which URL was in the invitation you sent me in November*; they ask whether one was sent, to whom, and when — and the chain in `message_events` answers all three. If a template ever holds a field somebody would genuinely want replayed, it does not belong in this list.

**What is deliberately not done.** The interval between queue and send is not closed further. Encrypting the payload at rest would mean a key, and a key in the same environment as the database is a longer sentence describing the same exposure. Sending straight from the action rather than queueing would mean a comms failure could roll back an invitation that was already created — and worse, would put an HTTP call to a mail provider inside a path a board is waiting on. The queue is the right shape; five minutes is the right window.

**And the rule this narrows.** ADR-0003 says only the hash is stored. That remains true of `judge_assignments`, of `board_assignments`, and of `invitations` itself — the tables that *authorize*. It is no longer true of the outbox, which is not an authorization table but a record of what was said. The distinction is worth stating plainly, because "we never store a raw token" is the kind of sentence that gets repeated after it has stopped being true.

## When this changes

If a second template ever needs to carry a credential, this list is where it is declared and this decision is what it is measured against — the questions are *how long does it need it*, *what does a leak of it grant*, and *would anybody want that field replayed*. If the answer to the last one is yes, the template is wrong rather than the list.
