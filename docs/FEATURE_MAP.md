# Feature map

Every feature Callboard will ever have, on one page, mapped to the gate that decides when it gets built. Each ID traces to [`PRD.md`](PRD.md) (A1–A11 §8.2, B1–B8 §8.3, G1–G6 §9); tables to [`DATA_MODEL.md`](DATA_MODEL.md); rationale to [`decisions/`](decisions/).

**B9 and B10 are the exceptions** — they have no PRD entry, because they did not exist when §8.3 was written. Both came out of building B6 and B7 and finding what those actually needed: an audit export the board can read without learning which judge is which, and a kill switch for a leaked link. They are recorded here, and their rationale is in [ADR-0008](decisions/0008-judge-scores-are-de-identified.md) and [ADR-0011](decisions/0011-nothing-mints-a-link.md).

This map **sequences; it does not authorize.** The PRD argues against building (§13). Nothing below the gate starts before three founding partners sign — building it to win a signature spends the whole selling window on boards that have committed nothing. This is the build order for the moment the gate clears, not a to-do list that ignores it.

**Status**

| | |
|---|---|
| **Live** | shipped and deployed at `callboard-eta.vercel.app` |
| **Designed** | specced in `docs/`, not built |
| **Won't build** | the tarpit — stays in the tools that already do it |

Counts: **14 live** — 10 (Module B) + 2 (Module A) + 2 (Adjacent) · **12 designed** (Module A) · **6 designed** (the Gita) · the rest below.

---

## Phase 00 — Shipped · the scoring demo · **Live**

Module B (Tabulation), PRD §8.3. Judges score from any phone; the math runs itself; results lock into a snapshot that reproduces the next day. This is the sales instrument — the one thing PRD §8.4 says to build before selling.

| ID | Feature | Detail | Source |
|---|---|---|---|
| **B1** | Per-comp rubric configuration | Criteria, weights (integer basis points), normalization, tiebreakers are data, authored in a config file — not hardcoded. Fusion and classical rubrics differ entirely. | `rubrics`, `rubric_criteria` |
| **B2** | Score from any phone, no install | A signed link; the raw 32-byte token lives only in the URL, its sha256 in the database. The form is plain HTML and submits without JavaScript. | ADR-0003, `judge_assignments` |
| **B3** | Auto-normalization | Raw mean, per-judge z-score, or negated mean rank — per rubric. A zero-spread judge contributes 0, never NaN. | `normalize.ts` |
| **B4** | Deduction entry | Time penalties applied to every judge's per-team total *before* normalization — the only well-defined choice when the aggregate is standard deviations. | `deductions` |
| **B5** | Live tabulation + tiebreaks | Standings update every 2s. Ties broken by an ordered list (criterion, head-to-head Copeland, highest single judge); a surviving tie is surfaced, never silently picked. A score naming a team that is not on the roster is ignored — `teams` is the roster of record, and a team that withdrew must not keep placing with the scores it was already given. | ADR-0009, `rank.ts` |
| **B6** | Locked, attributed audit trail | Locking freezes inputs, rubric, results into one row. A correction **replays that frozen row** and appends its deduction — it never re-reads the tables, so nothing written after the lock can enter it — and every lock and override carries a person's name. A score that lands after the lock counts in no run, and the board is told. Closed July 2026. | ADR-0004, ADR-0007, `tab_runs` |
| **B7** | Blind judging, both directions | A judge's projection of a team never selects its name; the board's projection of a judge *beside a score* never selects theirs. Blindness is a property of the return type both ways — a compile error to leak. Closed July 2026. | ADR-0008, `scope.ts` |
| **B8** | Emcee sheet + per-team feedback | A printable placement sheet the emcee reads from directly. Each team's feedback file carries its placement, its deduction and the reason, and each judge's note under `Judge N` — and **no scores**. One file per team, so a forward cannot leak a rival's notes. | ADR-0008, `export/feedback.ts` |
| **B9** | Board score breakdown | The board's own audit export: every judge's score on every criterion, from the frozen snapshot, under `Judge 1 / Judge 2`. Lets a board spot a rogue judge without learning which of its judges it was. | `export/scores.ts` |
| **B10** | Revocable links, both kinds | A leaked judge *or board* link can be killed from the board screen. Board revocation outlives the lock, because a board link is the one that can still override a locked result — and the last live link is refused, because nothing mints a replacement. | ADR-0011, `board_assignments` |

---

## ▓▓▓ The founding-partner gate · PRD §13 ▓▓▓

**This line was drawn to hold until the gate cleared. It has been crossed three times**, each at the founder's direction: A1 and A2 in July 2026, ADJ·3 on July 31, and the money spine (A6–A9) on the same day. The gate itself has not moved — Track 1 is **0/10 conversations and 0/3 signatures** — so the line is recorded here as breached rather than redrawn, because a line that moves to wherever the code got to is not a line.

What remains genuinely gated is named in each phase heading below, and the largest piece of it is Stripe (A5–A5c). The selling window is **August**; boards for spring 2027 are forming now. Nothing on this page moves Track 1.

The founding season is **free** ($0; $300 from 2027–28), so a "yes" costs a board nothing and is worth nothing. A signature is a named person, a comp date, **their roster / fee schedule / last season's payment records**, and a **written $300 line in the budget they hand their successors**. Those are the things a board can only give if it means it.

| Target | | By |
|---|---|---|
| Board conversations, across 3+ circuits | **10** | Sept 15, 2026 |
| Signed founding partners | **3** | Sept 15, 2026 |
| League check (Origins / NDDL) | complete | Sept 15, 2026 |

≥3 → build Sept–Dec, ship free for the Jan–Mar 2027 season. <3 after 10 real conversations → hobby build for Mayuri and Minza only.

**Gate 2 · April 30, 2027** — ≥2 of 3 founding partners pay for 2027–28, or the free year was a failed experiment and this stops.

---

## Phase 01 — v1 · Module A · Registration · **A1–A2 live · A3 authorized · A4 gated**

The spine, and the registration lead's pain. Roster and money live in one record so the acceptance-doc-vs-Venmo split that made "who paid" unanswerable at Mayuri 2026 cannot happen.

**A1 and A2 were built in July 2026, before the gate cleared**, at the founder's direction. That is recorded here rather than tidied away: the map says it sequences and does not authorize, and this is what it looks like when the sequence is run early. Everything else in Phases 01–07 remains gated, and Track 1 is still 0/10.

| ID | Feature | Status | Detail | Needs | Source |
|---|---|---|---|---|---|
| **A1** | Configurable registration form | **Live** | Per comp: team info, roster size, audition-video link, waiver acknowledgment — authored as data in the comp config, like the rubric. The public form is the first page with no `Actor`; the projection is the scope. What it collects, the board can *see*: the audition link, the captain, and the waiver are on the roster screen, because accepting a team is a decision made about its application. The bid code is minted by a read-then-insert, so two captains applying at once collide on `teams_comp_bid_code_unique` — the loser retries rather than being handed the failed SQL. A board adds its **own questions** the same way — `registration.fields`, one of `text \| longtext \| number \| select \| checkbox`, whose answers land in `teams.custom_answers` keyed by field id and are shown to the board under the labels it asked them in. The config is both the form and the schema its answers are validated against, so there is one definition of what a comp asked, and it is the one that survives to be read a year later. **No division field** ([ADR-0010](decisions/0010-a-comp-is-one-division.md)). | — | ADR-0010, `teams`, `people`, `comps.registration` |
| **A2** | Application → acceptance → waitlist | **Live** | The status lifecycle as one total transition map. Dropping a team that held a slot promotes the top of the waitlist, and the two land **in the same transaction** ([ADR-0012](decisions/0012-transactions-for-writes-that-span-statements.md)) or neither does. The roster freezes at the lock — reinstating a dropped team afterwards would hand it back scores it had already been given ([ADR-0009](decisions/0009-teams-is-the-roster-of-record.md)). A team the board waitlists joins the **back of the queue** — `waitlist_rank` is assigned on the way in, so promotion follows arrival order rather than uuid sort, which is what it followed while nothing in the product wrote that column. A board that wants a different order can say so: a reorder is a *trade* of two adjacent ranks, so it renumbers nobody else, and the lock freezes it because a rank is roster. One gap remains, and it is Phase 02's: obligations are *not* reconciled, because there are no `charges`. | A1 | ADR-0009, ADR-0012, `teams.status`, `transitions.ts` |
| **A3** | Roster + payment status, one record | **Live** | Joined by design, eliminating the acceptance-doc-vs-Venmo split. The structural fix, not a report. Built by *widening* `listRosterForBoard`, not by adding a fourth window: A3 asks no new question about which teams count, so money changes the columns and not the `where`. The question ADR-0012 reserved for the founding partners — whether Callboard *routes* money — stays reserved; this needs no rail. | A2, `charges` | ADR-0012, ADR-0014, PRD A3 |
| **A4** | Team submission portal | Designed | Post-acceptance materials: final music, roster updates, emergency contacts — a team-facing filtered view of the same record. **Not as free as it looks.** It needs a third actor kind (`Actor` is still `BoardActor \| JudgeActor`), a `team_assignments` table, and a migration widening `audit_log`'s `actor_kind` check. Above all it needs a **link**, and nothing mints one — that is [ADR-0011](decisions/0011-nothing-mints-a-link.md), a decision, not an oversight. | a third actor kind; a link-minting path ([ADR-0011](decisions/0011-nothing-mints-a-link.md)) | ADR-0011, PRD A4 |

---

## Phase 02 — v1 · Module A · Payments · **A6–A9 live · A5x gated**

The treasurer's pain, and why the ledger disagrees with the bank by ~$5,000 today. Callboard **never holds funds and never touches the org's tax status** — and today it does not move money at all: every `payments` row is hand-entered, on a rail we record and do not route. Every amount is integer cents.

**The split is the point.** The ~$5k gap is closed by the **ledger** — obligations, payments, allocations, roster joined to money — which works perfectly well on a hand-entered `rail: 'venmo'` row. **Stripe (A5–A5c) buys ingestion, not correctness**, and stays gated: building card rails before a board says it wants them is guessing, and [ADR-0005](decisions/0005-stripe-connect-standard-never-hold-funds.md) remains *designed, not implemented*. A6–A9 were authorized July 31, 2026, ahead of the gate; the decisions they rest on are [ADR-0002](decisions/0002-money-as-cents-and-allocations.md) and [ADR-0014](decisions/0014-the-allocation-counter.md).

| ID | Feature | Detail | Needs | Source |
|---|---|---|---|---|
| **A5** | Stripe Connect (Standard) | Each comp connects its own account; funds settle directly to the org, which owns payouts and the 1099. Callboard orchestrates and reconciles — never a money transmitter. | — | ADR-0005 |
| **A5a** | ACH-first routing | Lumps ($600–$2,160) route over ACH (0.8%, cap $5) by default; cards stay for small/last-minute items. Collapses a ~$11.5k season from ~$250 to ~$60–80. | A5 | PAYMENTS.md |
| **A5b** | Nonprofit card rate | Support the verified-nonprofit rate (2.2% + $0.30) in connected-account setup. Most host orgs qualify. | A5 | PRD A5b |
| **A5c** | Optional surcharge pass-through | Per comp, pass the processing fee to the paying team, disclosed at checkout (≤3%). The honest answer to "won't we net less than we charge?" | A5 | PRD A5c |
| **A6** | Fee schedule engine | **Live.** Per-dancer, per-room, deposit, late fee → each team's exact total. Pure and ESLint-fenced, so a bill is a function of the schedule and the roster and nothing else; `asOf` is passed in, because a module that read the clock would bill differently on Tuesday. A component the comp does not charge produces **no line**, not a $0 one, and an unknown room count produces a stated gap rather than a $0 hotel charge a treasurer would believe. | — | `fee_schedules`, `charges`, `src/lib/fees/` |
| **A7** | Refund state machine | **Live.** A refund is *not* a negative payment — negative gross would make `allocated_cents <= gross_cents` uninterpretable, and that ceiling is what ADR-0014 bought. So a deposit's fate is its own append-only chain, `deposit_events`, modelled on `tab_runs`: one row per transition ordered by `seq`, state is `max(seq)`'s row, and `deposit_events_terminal_unique` refuses a **second ending** — a double-clicked refund button being the realistic way a deposit is returned twice. `refund_failed` is deliberately not terminal: a bounced ACH return is retryable, and calling it an ending would strand money in a state the product cannot leave. Receipts are **not** built. | A6 | ADR-0014, `deposit_events` |
| **A8** | Fee-aware ledger | **Live.** gross / fee / net as three integers per payment, allocated to charges. A $100 deposit arriving as $97.01 is a recorded cost, not a hole; NCSU's $2,160 unbundles across three obligations. The second and last sanctioned `withTransaction` caller, and the third reader of `violatedConstraint` — a money constraint is a sentence for a treasurer. Every row is hand-entered on a rail we record and do not route. | A6 | ADR-0002, ADR-0014, `payment_allocations` |
| **A9** | Who-owes / who-paid dashboard | **Live.** Per team, one screen, debtors first, with a CSV a treasurer opens beside a bank statement. The totals row is asserted in e2e against the sum of the rows it displays, because a summary that disagrees with its own rows is the ~$5,000 gap in miniature. A team that was never billed is omitted rather than shown settled. The headline metric: hours → under a minute. | A2, A6, A8 | PRD A9 |
| **A10** | One-click late-payer reminders | Replaces manual per-team texting; fires off payment status through the comms layer. | A9, comms | PRD A10 |
| **A11** | Google Drive import (on-ramp) | One-directional, onboarding only: ingest roster and prior-year Gita. Kills the "we already have it in Sheets" objection. Drive is never the backend. | — | PRD A11 |

---

## Phase 03 — v1 · Platform · **Designed (gated)**

What Module A needs underneath it. Real accounts arrive only when there is something worth protecting beyond a single comp's scores. Setup UI stays deferred — founder-run white-glove is the strategy (PRD §12), not a gap.

| ID | Feature | Detail | Source |
|---|---|---|---|
| **P1** | Real board accounts | Email, password, sessions — replacing the per-person signed link once a board manages money and rosters across a whole comp. | ARCHITECTURE.md, `board_assignments` |
| **P2** | Setup UI *(deferred)* | Rubric builder, roster import, board-account management. Deliberately deferred: a founder runs the seed script by hand for founding customers — one config and one seed per comp, and a board running two divisions is a board running two comps ([ADR-0013](decisions/0013-a-seed-replaces-a-comp-not-an-org.md)). | ADR-0013, PRD §12, `seed-cli.ts` |
| **P3** | Postgres RLS hardening | Tenancy is app-layer today (every table carries `comp_id`, reads pass through the scope module). RLS is the eventual hardening, not a pre-first-customer task. | ADR-0006, `scope.ts` |

---

## Phase 04 — Adjacent tier · reads the same record · **2 live · 2 designed**

Nearly free because it reads the record that already exists. One piece shipped with Module B; the public page is the cheapest thing in the repo, being a projection with no auth and no new table.

| ID | Feature | Status | Detail | Source |
|---|---|---|---|---|
| **ADJ·1** | Per-team feedback export | **Live** | Shipped as B8's feedback CSV — one file per team, carrying its placement, its deduction and reason, and each judge's note under `Judge N`. It carries **no scores**, deliberately ([ADR-0008](decisions/0008-judge-scores-are-de-identified.md)): a team learns what the judges *said*, not what they gave. Same export as B8, listed here because it is what the adjacent tier asks for and it is already met. | ADR-0008, `export/feedback.ts` |
| **ADJ·2** | Judge feedback delivery | Designed | Notes are captured and exportable; *delivering* them to each team (email/portal) is the unbuilt half. Needs P1, comms. | `judge_notes` |
| **ADJ·3** | Public read-only info page | **Live** | The attendee's view at `/c/[org]/[comp]`: the comp's facts, a link to the form while registration is open, who is competing, and — once a result is locked — the placements. The second read in the product with no `Actor`, on `openRegistration`'s terms: the projection *is* the scope. It carries **no bid code**, because a judge is a member of the public and a public name-to-code pairing would end blind judging for that comp ([ADR-0008](decisions/0008-judge-scores-are-de-identified.md)); **no scores** (PRD B8); and only the teams actually in the comp, because whether a team was waitlisted or turned away is the board's business. Placements are read from the frozen snapshot and disappear if it stops reproducing — a result the product cannot verify is not one to publish. A `draft` comp 404s exactly as a nonexistent one does. | ADR-0008, PRD §7.2, `comp/public.ts` |
| **ADJ·4** | Food timing | Designed | The hospitality slice that already lives inside the Gita's derivation, surfaced on its own. | `schedule_segments` |

---

## Phase 05 — Spine completion · the Gita · **Designed**

PRD §9, the highest-value hard problem. The existing spreadsheet is a *compiler*; the missing product is the *runtime*. **G3 is the cell that doesn't exist today.**

| ID | Feature | Detail | Needs | Source |
|---|---|---|---|---|
| **G1** | Show-order ingestion | Accept the Friday-night draw (the mixer game's output) as the single schedule input. Everything else derives from it. | — | `show_order` |
| **G2** | Derivation engine | Reproduce the chained timings — walk, lobby, stretch, props, tech-in/out, food, judge cutoffs, transport — parameterized by named buffer variables. | G1 | `schedule_segments` |
| **G3** | Live delay input | The core new capability: one "running N minutes behind" input re-derives the entire cascade. The cell a human re-computes by mouth today. | G2 | PRD G3 |
| **G4** | Per-person now / next views | Each board member, liaison, and team sees only their own re-timed timeline — replacing the ~30-column hand-compiled SATURDAY sheet. | G3 | `assignments` |
| **G5** | Push on change | Every recalculation pushes to affected phones, so no copy goes stale. Fires through the comms engine. | G3, comms | PRD G5 |
| **G6** | Buffer awareness | Surface engineered slack (filler acts, the 20-vs-30-minute judge buffer) and flag when compound delays exhaust it — the board's stated breaking point. | G2 | PRD G6 |

---

## Phase 06 — Spine completion · coordination & comms · **Designed**

Built after paying customers exist. The comms engine is the keystone: it reads the same record and is the transport under late-payer reminders (A10) and Gita pushes (G5).

| ID | Feature | Detail | Source |
|---|---|---|---|
| **C1** | Liaison & volunteer coordination | Person ↔ duty ↔ time assignments, plus an SWA-training checklist. The `assignments` table is already modeled. | PRD §7.3 |
| **C2** | Comms engine | Announcements and pushes firing off the same record — dues reminders off payment status, schedule pushes off the Gita. Not sold standalone; delivered as the record's automatic output. | PRD §7.3, §12 |

---

## Phase 07 — Later / separate · **Designed, sequenced later**

Real, but after 2–3 live comps — or a different product shape entirely.

| ID | Feature | Detail | Source |
|---|---|---|---|
| **L1** | League common-app feed | Origins / NDDL common application and bid-point reporting. Strategic: the league is both the threat and the cheat code. | PRD §7.4, §6 |
| **L2** | After-party ticketing | A thin payment edge on the rails Module A already builds. Noted, not scheduled for v1. | PRD §7.4 |
| **L3** | Sponsorship CRM | Different data shape (sponsors ≠ teams), different user. Likely a separate product; parked. | PRD §5.2 |

---

## Phase ∞ — The tarpit · **Won't build**

Saying no here is what makes the yes credible. These stay in the tools that already do them well. The one exception: Callboard **ingests the show-order result** the mixer game produces — it does not run the game.

- **Design tooling** — flyers, logos, program layout → Canva / Figma.
- **Video editing** — hype and lineup videos → CapCut / Premiere.
- **The org's public website** — a separate build.
- **Mixer game-planning & decor** — human creative work.
- **SGA budgets & grant paperwork** — university systems.

---

*Derived from [`PRD.md`](PRD.md), [`ROADMAP.md`](ROADMAP.md), [`DATA_MODEL.md`](DATA_MODEL.md), and [`decisions/`](decisions/). When those change, this changes.*
