# Feature map

Every feature Callboard will ever have, on one page, mapped to the gate that decides when it gets built. Each ID traces to [`PRD.md`](PRD.md) (A1–A11 §8.2, B1–B8 §8.3, G1–G6 §9); tables to [`DATA_MODEL.md`](DATA_MODEL.md); rationale to [`decisions/`](decisions/).

This map **sequences; it does not authorize.** The PRD argues against building (§13). Nothing below the gate starts before three deposits land — building it to win a deposit spends what the deposit funds. This is the build order for the moment the gate clears, not a to-do list that ignores it.

**Status**

| | |
|---|---|
| **Live** | shipped and deployed at `callboard-eta.vercel.app` |
| **Designed** | specced in `docs/`, not built |
| **Won't build** | the tarpit — stays in the tools that already do it |

Counts: **8 live** (Module B) · **14 designed** (Module A) · **6 designed** (the Gita) · the rest below.

---

## Phase 00 — Shipped · the scoring demo · **Live**

Module B (Tabulation), PRD §8.3. Judges score from any phone; the math runs itself; results lock into a snapshot that reproduces the next day. This is the sales instrument — the one thing PRD §8.4 says to build before selling.

| ID | Feature | Detail | Source |
|---|---|---|---|
| **B1** | Per-comp rubric configuration | Criteria, weights (integer basis points), normalization, tiebreakers are data, authored in a config file — not hardcoded. Fusion and classical rubrics differ entirely. | `rubrics`, `rubric_criteria` |
| **B2** | Score from any phone, no install | A signed link; the raw 32-byte token lives only in the URL, its sha256 in the database. The form is plain HTML and submits without JavaScript. | ADR-0003, `judge_assignments` |
| **B3** | Auto-normalization | Raw mean, per-judge z-score, or negated mean rank — per rubric. A zero-spread judge contributes 0, never NaN. | `normalize.ts` |
| **B4** | Deduction entry | Time penalties applied to every judge's per-team total *before* normalization — the only well-defined choice when the aggregate is standard deviations. | `deductions` |
| **B5** | Live tabulation + tiebreaks | Standings update every 2s. Ties broken by an ordered list (criterion, head-to-head Copeland, highest single judge); a surviving tie is surfaced, never silently picked. | `rank.ts` |
| **B6** | Locked, attributed audit trail | Locking freezes inputs, rubric, results into one row. A correction supersedes — never edits — and every lock and override carries a person's name. Closed July 2026. | ADR-0007, `tab_runs` |
| **B7** | Blind judging by bid code | A judge's projection of a team never selects its name — blindness is a property of the return type, a compile error to leak. | `scope.ts` |
| **B8** | Emcee sheet + feedback export | A printable placement sheet the emcee reads from directly, plus a per-team feedback CSV read from the frozen snapshot. | `judge_notes`, `export/` |

---

## ▓▓▓ The deposit gate · PRD §13 ▓▓▓

**Nothing below this line is built until the gate clears.** The selling window is **August**; boards for spring 2027 are forming now. The build window is **Sept–Dec 2026**, and it only opens on paid validation. Deposits are refundable until January — which is what makes yes cheap.

| Target | | By |
|---|---|---|
| Board conversations, across 3+ circuits | **10** | Sept 15, 2026 |
| Paid deposits, refundable until January | **3** | Sept 15, 2026 |
| League check (Origins / NDDL) | complete | Sept 15, 2026 |

≥3 deposits → build Sept–Dec, ship for the Jan–Mar 2027 season. <3 after 10 real conversations → hobby build for Mayuri and Minza only.

---

## Phase 01 — v1 · Module A · Registration · **Designed (gated)**

The spine, and the registration lead's pain. Roster and money live in one record so the acceptance-doc-vs-Venmo split that made "who paid" unanswerable at Mayuri 2026 cannot happen.

| ID | Feature | Detail | Needs | Source |
|---|---|---|---|---|
| **A1** | Configurable registration form | Per comp: team info, roster, division, audition-video link, waiver acknowledgment, custom fields. | — | `teams`, `people` |
| **A2** | Application → acceptance → waitlist | Waitlist promotion reconciles obligations in the *same transaction* — a drop and a promotion update balances and slots together. | A1 | `teams.status` |
| **A3** | Roster + payment status, one record | Joined by design, eliminating the acceptance-doc-vs-Venmo split. The structural fix, not a report. | A2, charges | PRD A3 |
| **A4** | Team submission portal | Post-acceptance materials: final music, roster updates, emergency contacts — a team-facing filtered view of the same record. | — | PRD A4 |

---

## Phase 02 — v1 · Module A · Payments · **Designed (gated)**

The treasurer's pain, and why the ledger disagrees with the bank by ~$5,000 today. Callboard **never holds funds and never touches the org's tax status** — Stripe Connect Standard, funds settle direct to the org. Every amount is integer cents.

| ID | Feature | Detail | Needs | Source |
|---|---|---|---|---|
| **A5** | Stripe Connect (Standard) | Each comp connects its own account; funds settle directly to the org, which owns payouts and the 1099. Callboard orchestrates and reconciles — never a money transmitter. | — | ADR-0005 |
| **A5a** | ACH-first routing | Lumps ($600–$2,160) route over ACH (0.8%, cap $5) by default; cards stay for small/last-minute items. Collapses a ~$11.5k season from ~$250 to ~$60–80. | A5 | PAYMENTS.md |
| **A5b** | Nonprofit card rate | Support the verified-nonprofit rate (2.2% + $0.30) in connected-account setup. Most host orgs qualify. | A5 | PRD A5b |
| **A5c** | Optional surcharge pass-through | Per comp, pass the processing fee to the paying team, disclosed at checkout (≤3%). The honest answer to "won't we net less than we charge?" | A5 | PRD A5c |
| **A6** | Fee schedule engine | Per-dancer, per-room, deposit, late fee → each team's exact total, generated as charges. No lump ever needs hand-unbundling again. | — | `fee_schedules`, `charges` |
| **A7** | Receipts + refund state machine | Refundable deposits need a clean state machine. ACH and card refunds differ in timing and retained fees; the ledger reflects what came back. | A6 | `charges.kind` |
| **A8** | Fee-aware ledger | gross / fee / net as three integers per payment, allocated to charges. A $100 deposit arriving as $97.01 is a recorded cost, not a hole. Lumps unbundle via allocations. | A6 | ADR-0002, `payment_allocations` |
| **A9** | Who-owes / who-paid dashboard | Applied / accepted / paid / outstanding, per team, one screen, rail-labeled. The headline metric: hours → under a minute. | A2, A6, A8 | PRD A9 |
| **A10** | One-click late-payer reminders | Replaces manual per-team texting; fires off payment status through the comms layer. | A9, comms | PRD A10 |
| **A11** | Google Drive import (on-ramp) | One-directional, onboarding only: ingest roster and prior-year Gita. Kills the "we already have it in Sheets" objection. Drive is never the backend. | — | PRD A11 |

---

## Phase 03 — v1 · Platform · **Designed (gated)**

What Module A needs underneath it. Real accounts arrive only when there is something worth protecting beyond a single comp's scores. Setup UI stays deferred — founder-run white-glove is the strategy (PRD §12), not a gap.

| ID | Feature | Detail | Source |
|---|---|---|---|
| **P1** | Real board accounts | Email, password, sessions — replacing the per-person signed link once a board manages money and rosters across a whole comp. | ARCHITECTURE.md, `board_assignments` |
| **P2** | Setup UI *(deferred)* | Rubric builder, roster import, board-account management. Deliberately deferred: a founder runs the seed script by hand for founding customers. | PRD §12, `seed-cli.ts` |
| **P3** | Postgres RLS hardening | Tenancy is app-layer today (every table carries `comp_id`, reads pass through the scope module). RLS is the eventual hardening, not a pre-first-customer task. | ADR-0006, `scope.ts` |

---

## Phase 04 — Adjacent tier · reads the same record · **Mostly designed**

Nearly free because it reads the record that already exists. One piece already shipped with Module B.

| ID | Feature | Status | Detail | Source |
|---|---|---|---|---|
| **ADJ·1** | Per-team score export | **Live** | Already shipped as the Module B feedback CSV — scores and notes per team, from the frozen snapshot. | `export/feedback.ts` |
| **ADJ·2** | Judge feedback delivery | Designed | Notes are captured and exportable; *delivering* them to each team (email/portal) is the unbuilt half. Needs P1, comms. | `judge_notes` |
| **ADJ·3** | Public read-only info page | Designed | The brochure/general-info view an attendee sees — a filtered projection, no auth. | PRD §7.2 |
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
