# Pipeline

The [PRD §13](PRD.md) gate decides whether Callboard is a business or a hobby build. This page counts it. It is the only number that matters between now and September, and it is the one thing in this repo that writing more code cannot move.

## The gate

| | Target | By |
|---|---|---|
| Board conversations, across 3+ circuits | **10** | Sept 15, 2026 |
| Paid deposits, refundable until January | **3** | Sept 15, 2026 |
| League check (Origins / NDDL) | complete | Sept 15, 2026 |

**The deposit is $100**, against a $300 founding-season price, fully refundable until January. The number needed to exist before it could be asked for: for two calls it did not, and on both the ask never came. The script is in [DEMO.md](DEMO.md#the-ask).

**≥3 deposits** → build Sept–Dec, ship for the Jan–Mar 2027 season.
**<3 after 10 real conversations** → hobby build for Mayuri and Minza only, and stop calling it a business.

The selling window is **August**, before the fall crush. Boards for spring 2027 are forming now.

## Scoreboard

*Last updated July 11, 2026 — 66 days to the gate.*

| | |
|---|---|
| Real conversations | **0 / 10** |
| Circuits represented | **0 / 3** |
| Paid deposits | **0 / 3** |
| League check | not started |

## What counts as a real conversation

PRD §13 says *ten real conversations*, and the adjective is load-bearing. A number you can inflate is a number that will lie to you in September, when it is too late to do anything about it.

**A conversation counts only if you demoed and you asked for the deposit.**

Not "they seemed interested." Not a coffee chat, not a DM thread, not a board that said they'd love to see it sometime. Demoed, and asked. A conversation where the ask never came is a **0** — and if several of those pile up, the thing to fix is the asking, not the product.

A board that says no to a *fully refundable* deposit after seeing the demo is the cheapest possible no, and it is worth more than a maybe. Write it down and move on.

## Boards

Names and circuits only — no contact details, so this file stays committable.

| Board | Circuit | First contact | Stage | Deposit |
|---|---|---|---|---|
| *(fill in)* | — | Jul 10, 2026 | demoed | **not asked — scores 0** |
| *(fill in)* | — | Jul 11, 2026 | demoed | **not asked — scores 0** |

Row 1 saw the deployed demo on July 10, liked it, and asked to see it "finished." Read: they want the money product — registration and payments, Module A.

Row 2 saw it on July 11, said it was "really good," and named one condition: the board must not be able to see what individual judges put. They also offered that hospitality — room management — was something worth building for them.

Both boards named a feature and neither was asked for a deposit. **Two demos, two wishlists, zero asks.** That is the exact failure this page warns about three paragraphs up, and the fix is the asking, not the product. There is now an ask script in [DEMO.md](DEMO.md#the-ask) and a deposit number, both of which were missing while those calls happened.

**What the feature requests actually are.** Payments coming out of a prospect's mouth unprompted is the PRD's own thesis handed back (§2.3 ranks payments as *the* pain, scoring as a *someday* pain). Rooming is the same signal wearing a different hat: it sits directly on top of registration and payments, since you cannot assign rooms to teams you have no paid roster for. Both are **deposit-ask triggers, not build triggers.** Building Module A to earn a deposit spends exactly what the deposit is meant to fund, and burns the August window doing it. The move on both boards is [PAYMENTS.md](PAYMENTS.md) — the treasurer-checkable argument, already written — followed by the ask.

**Row 2's condition was real, and it has been fixed** ([ADR-0008](decisions/0008-judge-scores-are-de-identified.md)): the board now sees `Judge 1 / Judge 2 / Judge 3` beside every score and never a name, and teams get written feedback with no scores at all. That is a callback and the strongest reopen available — *the thing you asked for is live, here's the link* — and it must end in the ask.

## Stages

```
identified → contacted → demo booked → demoed → deposit asked → paid | declined
```

A board sitting at `demoed` for more than a week is a board you have not asked. That is the only stall this table is designed to make visible.

---

*The gate is in [PRD.md §13](PRD.md) and [ROADMAP.md](ROADMAP.md). The build order for the moment it clears is in [FEATURE_MAP.md](FEATURE_MAP.md) — which sequences, and does not authorize.*
