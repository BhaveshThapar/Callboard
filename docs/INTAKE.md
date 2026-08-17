# Intake — what a founding partner sends, and what it buys them

**Audience: the treasurer or president who said yes.** This page is written to be forwarded. Everything else in `docs/` is written for the founder; this one is not, so keep it in language a board can act on without reading the rest of the repo.

It exists because PRD §13 and the demo script were asking for **two different lists** and nothing connected them. They are different on purpose, and the difference matters:

| | What it is | Why it's asked | Consumed by code today? |
|---|---|---|---|
| **Part 1 — your comp** | Rubric, teams, judges, board | It stands up *your* competition, so the next thing you see is your teams and your rubric, not a demo org's | **Yes** — `comp-config.json` → `bun run db:seed --config` |
| **Part 2 — your money** | Fee schedule, last season's payments | It is what registration and payments get built against, and it is what replaces the deposit | **The fee schedule, yes** — it configures your comp and the product bills from it. **Last season's payments, no** — see below, stated plainly rather than hidden |
| **Part 3 — your run-of-show** | The Gita workbook, your rooms, your buffers | It is the only place the numbers a schedule engine runs on actually exist | **Not yet** — the engine is being built *from* this, so it is asked for before the code rather than after |

Part 1 is small and has a fast payoff. Part 2 is the one that costs real hours, and that is the point of it. Part 3 is the one nobody has been asked for yet, and it is the one that decides whether comp-day mode is real.

---

## Part 1 — what stands up your comp

Plain answers are fine. Send it in a doc, an email, a spreadsheet, a voice note. No forms, no formats, no account to create — the setup is run by hand for founding partners on purpose ([PRD §12](PRD.md)), so a person reads this, not a parser.

**The comp**
- Org name, comp name, comp date, venue.

**The score sheet** — this is the part people usually have to go find, and it is the part that makes the tabulation yours.
- Every criterion you judge on, and what each is out of. *(e.g. Choreography /25, Execution /25, Energy /25, Costume /10.)*
- Does any criterion count for more than its raw points suggest? Say so in plain words — "energy is weighted heavier than costume" is enough.
- How do you combine judges: raw totals, or normalized so one harsh judge can't sink a team? If you don't know, say so — that is a real conversation and it is worth having before comp day, not after.
- **How do you break a tie?** In order. *(e.g. highest Execution, then head-to-head, then highest single judge's score.)* Most boards have never written this down, and it is the single thing most likely to blow up on stage.

**The teams**
- Team name, school, and **bid code** — the anonymized code the judges see instead of the name. If you already run blind judging, send your existing codes; if you don't, we make them.
- Performance order, if you have it.
- **If you run divisions, send each one separately** — its own teams, its own judges, its own score sheet (they are usually different anyway). A division is scored as its own competition, because that is what it is: nobody places a classical team against a fusion team. You get a board screen and a set of judge links per division. Say so up front if you run more than one, since it changes what the score sheet section above is asking for.

**Your registration form**, if you want teams to apply through it rather than being seeded.
- We collect team name, school, roster size, an audition-video link and a waiver acknowledgment as standard. **Anything else you ask, send us the questions** — the wording you want, and whether it is free text, a number, a dropdown (with its options), or a checkbox.
- Each question gets a short id we store the answers under. **Once applications start arriving, that id is frozen.** Rewording a question is fine and costs nothing; renaming or removing its id orphans every answer already filed, because an answer is stored against the id and is meaningless without the question. So it is worth spending a minute on the list before it goes live, and it is not worth panicking about the wording.

**The people**
- Judges: names (emails if you have them). Each gets a private link, one per phone.
- Board: names of whoever should see live results and lock the final placements. Board links are **per person**, not per board, because every lock and every override is attributed to a human being ([ADR-0007](decisions/0007-board-links-are-per-person.md)).

### What you get back

Your comp, seeded and live, with your teams and your rubric — judge links you can open on your own phones, and a board screen that tabulates and locks. **Turnaround is short: send Part 1 and you see it on the next call.**

You are not committing to anything by sending this, and it costs you nothing. If the tabulation doesn't convince you, you have lost a spreadsheet export.

---

## Part 2 — what registration and payments get built against

**Any format. Genuinely any.** A Venmo export, a bank CSV, the actual Google Sheet, a screenshot of the tab you gave up on. Do not clean it up — the mess *is* the data. A tidied sheet is a worse input, because it hides exactly the cases the system has to survive.

**Your fee schedule.** What a team owes and how it's built up: per dancer, per hotel room, a deposit, late fees and the date they kick in. *(Mayuri 2026, for reference: $70/dancer + $140/room + $100 deposit + late fees — which means every team owes a different number, and that is the normal case, not the hard one.)*

This one **is** entered into the product: it becomes your comp's configuration, and each team's total is generated from it and their roster rather than typed by hand. Send the room count per team if you have it. If you don't, say so rather than sending zeros — a team whose rooms are unknown gets **no hotel charge and a note saying why**, which is recoverable, whereas a $0 hotel charge looks settled and is not.

**Your duty list.** What jobs you assign people on comp day, and which of them need SWA training — team liaison, judge runner, hospitality, door. Just the names you actually use; five lines in an email is enough.

This one **is** entered into the product, the same way the fee schedule is: it becomes your comp's duty vocabulary, and a board assigns people against it. There is no default list on purpose. PRD §7.3 specifies coordination in one line and names no duties, so a list invented here would be this repo guessing at your comp — and a list of yours that does not fit is a signal about the design rather than a bug in the parser. Say if a duty is about **one team** (a liaison walking Nazaare) rather than about the comp, because that is what lets it hang off the running order later.

**Last season's payment records.** What actually arrived, however it arrived. What matters most is the ugly parts:
- Payments that came in as one lump covering several things. *(Mayuri's worst: a single $2,160 that was hotel + security deposit + registration, unbundled by hand.)*
- Payments that arrived as the wrong number. *(A $100 deposit that landed as $97.01, because the card fee came out first.)*
- Teams that dropped, and teams promoted off the waitlist after acceptances went out — and what happened to what they owed.
- Anything that never reconciled. Especially that.

### Be straight about what happens to it

**Your fee schedule and your duty list now have somewhere to go; your payment history still does not.** As of July 31, 2026 the tables that hold obligations and payments (`fee_schedules`, `charges`, `payments`, `payment_allocations`) are being built, so the fee schedule you send is entered as your comp's configuration and the product computes what each team owes from it. C1 landed on August 16, 2026, so the duty list is configuration too.

**Last season's records are different, and we are not going to pretend otherwise.** They are not imported. They go in a folder, and they are what the build is checked against — the $2,160 lump and the $97.01 deposit are test cases before they are anything else. There is no bulk import, and building one before seeing three real boards' exports would be guessing at the format.

**Why ask for it now, then?** Because the founding season is free, and free makes "yes" the cheapest word in the language. There is no deposit to prove a board means it. This is what proves it instead: it costs a treasurer real hours and real internal buy-in, and a board that will not go dig it out was never going to run its comp on this. It is also the difference between a payments system built against a founder's guesses and one built against a real $2,160 lump.

---

## Part 3 — what comp-day mode gets built against

**Send the Gita.** The actual workbook, not a description of it, and not a cleaned copy — the one
with the formulas in it, the tab somebody inherited from another comp, and the cell where a previous
author gave up. That last one is not a joke: the honest version of this file is more useful than a
tidy one, for Part 2's reason.

This is asked for **before** the schedule engine is written rather than after, and that ordering is
deliberate. The money spine was built against a fee schedule that was the repo's own best guess —
five fields, calibrated on one comp, and no board had handed one over. It worked, but only because
five numbers is a small enough guess to be wrong about cheaply. A run-of-show is not five numbers,
and a wrong one is not discovered by a treasurer in April. It is discovered on stage.

**Your rooms.** How many spaces run in parallel, and what each is for — stage, green room, stretch
space, tech booth, holding. *(Mayuri runs six.)* The product currently has no idea rooms exist, and
almost every timing in a Gita is really a statement about a room being free.

**Your buffers — the numbers between the events.** This is the part that only exists in your
spreadsheet's formulas, and it is the single thing this section is really asking for:

- How long before a team performs does it start walking? Where does it walk *from*?
- Lobby, stretch, props, tech-in and tech-out — how long is each, and what does each hang off?
- How much slack is engineered in on purpose — filler acts, exhibition padding, the gap you keep
  between the last score and the announcement?
- **How long do the judges actually get to deliberate, and how long do you tell them they get?**
  *(Mayuri: 20 minutes told, 30 minutes held. If you do something like this, say so — it is real
  scheduling slack and a system that does not know about it will spend it without telling you.)*
- Food: when does it arrive, and who eats when?
- Transport: what has to depart when, and what is it waiting on?

**And the one nobody writes down: what happens when you run late.** Tell the story. The comp where
you fell forty minutes behind — what moved, what got cut, what you told people, and at what point
the slack ran out and something had to actually give. This is the requirement for the feature this
whole section exists for, and it is the one thing that cannot be inferred from a spreadsheet, because
the spreadsheet is exactly what stops working at that moment.

### Be straight about what happens to it

Nothing is imported. The workbook goes in a folder beside last season's payment records, and the
buffers become **configuration** — the same shape your fee schedule and your rubric already take, so
the first real one to arrive is data rather than a migration.

**And a warning that is worth more than the ask:** if your Gita does not fit the shape the engine
ends up with, that is a fact about the design, not a bug in a parser. Say so loudly. A schedule
engine calibrated on one comp's workbook is a schedule engine that runs one comp.

---

## The third thing

Not data, and it is not optional: **a written $300 line in your 2027–28 budget**, in the document you hand to whoever replaces you.

The founding season is free. The season after it is $300, locked. You will have graduated by then — which means the board that gets asked to pay is a board that never chose this, never felt the reconciliation gap close, and never met me. A line item they inherit is a decision already made. A surprise invoice is a cancellation.

This is the one thing on this page that costs you nothing and is worth the most.
