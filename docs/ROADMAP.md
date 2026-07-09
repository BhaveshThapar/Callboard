# Roadmap

The PRD gates this build on paid validation. That gate is the most important thing on this page, and it comes first.

## The gate (PRD §13)

Nothing beyond the scoring demo gets built until these clear.

| | Target | By |
|---|---|---|
| Board conversations across 3+ circuits | **10** | Sept 15, 2026 |
| Paid deposits, refundable until January | **3** | Sept 15, 2026 |
| League check (Origins / NDDL) | complete | Sept 15, 2026 |

**≥3 deposits** → build Sept–Dec, ship for the Jan–Mar 2027 season.
**<3 deposits after 10 real conversations** → hobby build for Mayuri and Minza only, and stop calling it a business.

The selling window is **August**, before the fall crush. Boards for spring 2027 are forming now; registration windows open around September.

## Where the build actually is

**Shipped: the scoring demo.** PRD §8.4 — "one weekend of build: fake teams, three judges on phones, live tabulation on screen. Everything else waits for deposits."

- Per-comp rubric configuration, stored as data (B1)
- Judges score from any phone browser, no install (B2)
- Raw / z-score / rank normalization (B3)
- Deduction entry (B4)
- Live tabulation with configurable tiebreak logic (B5)
- Locked audit trail; nothing editable post-lock without an attributed override (B6)
- Blind judging via bid codes (B7)
- A placement table the emcee can read from (B8)

Meets the §8.3 acceptance test, encoded in `e2e/scoring.spec.ts`: 8 teams, 3 judges, phones, locked auditable placements, reproducible.

## v1 — "the part that bleeds money" (on ≥3 deposits)

Ship target: live for the **January–March 2027** season.

**Module A — Registration + Payments.** The spine, and the treasurer's pain.
- Configurable registration form; application → acceptance → waitlist workflow with promotion that reconciles balances (A1, A2)
- Roster and payment status joined by design (A3)
- Team submission portal for post-acceptance materials (A4)
- Stripe Connect Standard, ACH-first, nonprofit rate, optional surcharge (A5, A5a–c)
- Fee schedule engine; exact per-team totals (A6)
- Receipts, refunds, deposit state (A7)
- Fee-aware gross/net ledger (A8)
- One-screen dashboard: applied / accepted / paid / outstanding (A9)
- One-click reminders to late payers (A10)
- Google Drive import as the on-ramp (A11)

See [PAYMENTS.md](PAYMENTS.md) and [DATA_MODEL.md](DATA_MODEL.md) — both are already written.

**Module B — Tabulation.** Already built. What v1 adds: real board accounts, per-team feedback export, judge feedback delivery.

## Adjacent tier — nearly free, reads the same record

- Judge feedback delivery, per-team score export
- Public read-only info page
- Food timing (the hospitality slice already living in the Gita)

## Spine completion — after paying customers exist

- **Gita + comp-day mode.** The highest-value hard problem (PRD §9). The existing spreadsheet is a compiler; the missing product is the runtime. The one new capability is G3: a single "running N minutes behind" input that re-derives the whole cascade — the cell that does not exist today.
- Liaison and volunteer coordination; SWA-training checklist
- Comms engine: announcements and pushes, firing off the same record

## Later / separate

- League common-app feed (Origins / NDDL). Strategic; sequenced after 2–3 live comps. The league is both the threat and the cheat code (PRD §6).
- After-party ticketing — a thin payment edge
- Sponsorship CRM — different data shape, different user; likely a separate product

## The tarpit — never

Saying no here is what makes the yes credible.

Design tooling (Canva, Figma) · video editing (CapCut) · the org's public website · mixer game-planning and decor · SGA budgets and grant paperwork.

The one exception: Callboard **ingests the show-order result** the mixer game produces, because that is the single input the Gita needs. It does not run the game.

## Success metrics (PRD §13)

Per comp, v1:

| | From | To |
|---|---|---|
| Time to answer "who owes what / who has paid" | hours | **< 1 minute** |
| Reconciliation error vs. bank | ~$5,000 | **$0** |
| Last score → locked placements | unmeasured | **< 5 minutes** |
| Next-day reproducibility of results | "in a folder, maybe recycled" | **100%** |
| Setup-to-live for a new board | — | **≤ one weekend** |

The last two are already enforced in CI. The rest wait on Module A.
