# Pipeline

The [PRD §13](PRD.md) gate decides whether Callboard is a business or a hobby build. This page counts it. It is the only number that matters between now and September, and it is the one thing in this repo that writing more code cannot move.

## The gate

**The founding season is free** (PRD §11). $0 for the first three boards, Module A included; $300 flat from 2027–28. That removes the deposit — which was the costly signal — so the gate now asks for something else that is expensive to give.

### Gate 1 — founding partners · by Sept 15, 2026

| | Target | By |
|---|---|---|
| Board conversations, across 3+ circuits | **10** | Sept 15, 2026 |
| **Signed founding partners** | **3** | Sept 15, 2026 |
| League check (Origins / NDDL) | complete | Sept 15, 2026 |

**≥3** → build Sept–Dec, ship free for the Jan–Mar 2027 season.
**<3 after 10 real conversations** → hobby build for Mayuri and Minza only, and stop calling it a business.

### Gate 2 — conversion · by April 30, 2027

**≥2 of 3** founding partners pay $300 for the 2027–28 season. **<2 → the free year was the experiment, and it failed. Stop.**

This gate exists because free did not remove the willingness-to-pay question, it *postponed* it — from September, when a deposit would have answered it for $300 of signal, to April, after Module A has been built. Do not let it slip quietly. It is the one that decides whether this is a business.

The selling window is **August**, before the fall crush. Boards for spring 2027 are forming now.

## Scoreboard

*Last updated July 14, 2026 — **63 days** to Gate 1, and roughly **18 days** to the August selling window.*

| | |
|---|---|
| Real conversations | **0 / 10** |
| Circuits represented | **0 / 3** |
| Signed founding partners | **0 / 3** |
| League check | not started |
| *Gate 2 — converted to paid* | *0 / 2 · opens April 2027* |

## What counts

PRD §13 says *ten real conversations*, and the adjective is load-bearing. A number you can inflate is a number that will lie to you in September, when it is too late to do anything about it.

**A conversation counts only if you demoed and you made the ask.** Not "they seemed interested." Not a coffee chat, not a DM thread, not a board that said they'd love to see it sometime. Demoed, and asked — for the three things below, by name, out loud, before the call ended. A conversation where the ask never came is a **0** — and if several of those pile up, the thing to fix is the asking, not the product.

**A signature counts only if all three of these landed.** Free makes "yes" the cheapest word in the language, so the yes is worth nothing on its own and none of these may be waived:

1. **A named person and a named comp date.** A treasurer or president, not "the board."
2. **Their real data**, in your hands: roster, fee schedule, last season's payment records. This replaces the deposit. It costs a board real hours and real internal buy-in, and a treasurer who will not go dig it out was never going to run their comp on this. You need it to build anyway. [INTAKE.md](INTAKE.md) is what you send them, and it is written to be forwarded.
3. **A written $300 line in the 2027–28 budget** they hand to their successors — the board that will actually be asked to pay.

**There is no document to sign, and there will not be one.** A contract from a student vendor buys nothing a broke board would honour anyway, and drafting one is a way to feel productive without making the ask. The signature *is* the three artifacts — things you can hold, not things they say. So `signed` is checked against your inbox, never against your memory of the call. A verbal yes is not a signature. An email saying yes is not a signature. Enthusiasm is not a signature. Free makes all three of those free to give, which is exactly why none of them counts.

The consequence is that the ask has no paperwork step to hide behind: you ask on the call, and then either the roster arrives or it does not.

A board that will happily take it for free but will not do (2) or (3) is the free-model equivalent of a board that would not put down a refundable deposit. It is a **no**, and it is the cheapest no you will get. Write it down and move on.

## Boards

Names and circuits only — no contact details, so this file stays committable.

| Board | Circuit | First contact | Stage | Signed |
|---|---|---|---|---|
| *(fill in)* | — | Jul 10, 2026 | demoed | **not asked — scores 0** |
| *(fill in)* | — | Jul 11, 2026 | demoed | **not asked — scores 0** |

Row 1 saw the deployed demo on July 10, liked it, and asked to see it "finished." Read: they want the money product — registration and payments, Module A.

Row 2 saw it on July 11, said it was "really good," and named one condition: the board must not be able to see what individual judges put. They also offered that hospitality — room management — was something worth building for them.

Both boards named a feature and neither was asked for anything. **Two demos, two wishlists, zero asks.** That is the exact failure this page warns about, and the fix is the asking, not the product. There is now an ask script in [DEMO.md](DEMO.md#the-ask); there was none while those calls happened.

**What the feature requests actually are.** Payments coming out of a prospect's mouth unprompted is the PRD's own thesis handed back (§2.3 ranks payments as *the* pain, scoring as a *someday* pain). Rooming is the same signal wearing a different hat: it sits directly on top of registration and payments, since you cannot assign rooms to teams you have no paid roster for. Both are **ask triggers, not build triggers.** Building Module A to win a signature spends the whole August window on a board that has committed nothing. The move on both is [PAYMENTS.md](PAYMENTS.md) — the treasurer-checkable argument, already written — followed by the ask.

Under a free founding season the temptation is worse, not better: with no price to negotiate, "just build me X and I'll use it" is the *only* currency a board has left to offer, and it is not currency. The counter is the signature — their data and their budget line — which is exactly what a board that means it will hand over, and exactly what a board that is being polite will not.

**Row 2's condition was real, and it has been fixed** ([ADR-0008](decisions/0008-judge-scores-are-de-identified.md)): the board now sees `Judge 1 / Judge 2 / Judge 3` beside every score and never a name, and teams get written feedback with no scores at all. That is a callback and the strongest reopen available — *the thing you asked for is live, here's the link* — and it must end in the ask.

## Stages

```
identified → contacted → demo booked → demoed → asked → signed | declined
                                                              ↓
                                          (Jan–Mar 2027: runs their comp free)
                                                              ↓
                                            April 2027 → renewed | churned
```

A board sitting at `demoed` for more than a week is a board you have not asked. That is the only stall this table was designed to make visible — and free adds a second one: a board sitting at `signed` without having sent its roster and its budget line has not actually signed.

---

*The gate is in [PRD.md §13](PRD.md) and [ROADMAP.md](ROADMAP.md). The build order for the moment it clears is in [FEATURE_MAP.md](FEATURE_MAP.md) — which sequences, and does not authorize.*
