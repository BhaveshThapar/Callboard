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

*Last updated August 1, 2026 — **45 days** to Gate 1. The August selling window is **open**, and the three numbers that matter have not moved since July 11.*

| | |
|---|---|
| Real conversations | **0 / 10** |
| Circuits represented | **0 / 3** |
| Signed founding partners | **0 / 3** |
| League check | **complete · Aug 1, 2026** ([findings](#league-check)) |
| *Gate 2 — converted to paid* | *0 / 2 · opens April 2027* |

The league check was the one Gate 1 line item that could be closed without a phone call, and closing it moved nothing else. Three of the four rows above are still zero.

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

## League check

**Complete, August 1, 2026.** PRD §6 calls the league "both the threat and the cheat code", and Gate 1 asks whether it is one, the other, or neither. The answer is *both, but not the leagues we named* — there are **three** governing bodies rather than two, and the software incumbent is a fourth party that is not a league at all.

| | What it is | Scale | Ships software? |
|---|---|---|---|
| **DDN / Legends** | 501(c)(3), 2014. Legends is its Bollywood-Fusion championship | ~24 partner comps | A fan iOS app, and **ELO in a Google Sheet**. `commonapp.desidancenetwork.org` is a dangling Heroku CNAME |
| **Raas All-Stars** | 2009, 18th season. Governs Raas-Garba via bid comps | ~12 bid comps | A fan iOS app. Rubrics on Google Drive |
| **NDDL** | 501(c)(3), season 4. CEOs and a named CTO | **7** partner comps | **A real portal** — Next.js/Vercel/Supabase, with `/judge` and `/admin` routes |
| **[Ekta](https://about.ekta.app/)** | Not a league. The Desi Common Application, 2017 → | Claims four circuits | **The incumbent.** Applications only |

**1. The common-app space is occupied, and not by a league.** Ekta has run the common application since 2019–20; DDN's own attempt at one is a dead hostname. Ekta does **no** payments, fees, deposits, balances, scoring, judging, or tabulation — which is the entire Callboard surface. It is a boundary and possibly an integration, not a competitor, and it is a second independent reason A4 stays gated. *Its four-circuit claim is its own; it could not be confirmed on RAS's or East Coast Showdown's sites.*

**2. NDDL is building the competitor, and is still small enough that which way it goes matters.** Its partner-competition packet mandates NDDL-approved judges and the official 1,100-point rubric — "PCs may not create separate scoring criteria" — plus exclusive ticketing, approved media vendors, and central roster ownership: "PCs may not request separate rosters from teams." A **$300** application fee per partner comp, which is the same number as a whole Callboard season. Its `/judge` route is currently a stub. Seven comps against DDN's ~24.

**3. Two published, mandatory league rules do not fit the data model.** This is the check earning its place on the gate, and neither is a bug.

- **RAS bid comps carry a $100 deposit that forfeits *partially*** — $25 returned for clear communication, $75 for prop-box dimensions and fair logistics. `deposit_events` has `refunded` and `forfeited` as whole-amount terminal states, so returning $25 of $100 is unrepresentable. Migration `0010` shipped hours before this was found. Note the relationship is league→bid-comp, not team→comp, so it is the *shape* that is the signal rather than a direct requirement.
- **RAS requires a minimum of 6 judges in 3 category pairs** (2 choreography, 2 execution, 2 artistic elements), and its seventh tiebreaker is "average of standardized scores across all attended bid competitions". Callboard is one rubric, one judge pool, every judge scoring everything ([ADR-0010](decisions/0010-a-comp-is-one-division.md)). Per-category panels are not representable, and that tiebreaker implies bid comps hand the league normalized scores rather than placements.

Both are the same shape as the fee-schedule guess: **a real board's rules arriving and not fitting is information about the design.** Neither gets built on until a partner in that circuit asks for it, and no conversation has happened with any RAS comp.

**Price anchor.** The closest analog anywhere is [Marching Maestro](https://get.marchingmaestro.com/) — registration, fees, judge app and tabulation for marching competitions — at **$99/event plus 3.5% + 30¢**. CompetitionSuite charges $2–$10 per performance; Tabroom is free to 50 entries then $1/entry. Against those, $300/season for a comp of 8–30 teams is not obviously mispriced in either direction. And across roughly forty products surveyed, **none** advertises allocating one payment across several charges, partial payments, deposits with forfeit states, or reconciling an off-rail payment. Every vendor sidesteps it by requiring card payment up front, which this circuit demonstrably does not do.

**What it does not change.** Three of the four Gate 1 rows are still zero, and nothing above moves them.

---

*The gate is in [PRD.md §13](PRD.md) and [ROADMAP.md](ROADMAP.md). The build order for the moment it clears is in [FEATURE_MAP.md](FEATURE_MAP.md) — which sequences, and does not authorize.*
