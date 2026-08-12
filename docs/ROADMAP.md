# Roadmap

The PRD gates this build on validation. That gate is the most important thing on this page, and it comes first.

## The gates (PRD §13)

The founding season is **free** — $0 for the first three boards, $300 from 2027–28 (§11). Free removes the deposit, so Gate 1 asks for the things a board can only give if it means it, and Gate 2 finally asks the money question that free postponed.

**Gate 1 — founding partners · Sept 15, 2026.** Nothing beyond the scoring demo gets built until this clears.

| | Target | By |
|---|---|---|
| Board conversations across 3+ circuits | **10** | Sept 15, 2026 |
| **Signed founding partners** — named person + comp date, their roster/fee schedule/payment records, and a written $300 line in the 2027–28 budget | **3** | Sept 15, 2026 |
| League check (Origins / NDDL) | complete | Sept 15, 2026 |

**≥3** → build Sept–Dec, ship free for the Jan–Mar 2027 season.
**<3 after 10 real conversations** → hobby build for Mayuri and Minza only, and stop calling it a business.

**Gate 2 — conversion · April 30, 2027.** ≥2 of 3 founding partners pay $300 for the 2027–28 season. **<2 → the free year was the experiment, and it failed. Stop.** This is the gate free created: the willingness-to-pay question did not disappear, it moved from September to April, and it now gets answered *after* Module A is built rather than before.

The selling window is **August**, before the fall crush. Boards for spring 2027 are forming now; registration windows open around September.

Progress is counted in [PIPELINE.md](PIPELINE.md), which also defines what makes a conversation *real* — you demoed, and you asked them to sign.

## Where the build actually is

**Shipped: the scoring demo.** PRD §8.4 — "one weekend of build: fake teams, three judges on phones, live tabulation on screen. Everything else waits for three signed founding partners."

- Per-comp rubric configuration, stored as data (B1) — authored via `comp-config.json`, seeded by the founder. Not a rubric builder; that waits for the gate.
- Judges score from any phone browser, no install (B2)
- Raw / z-score / rank normalization (B3)
- Deduction entry (B4)
- Live tabulation with configurable tiebreak logic (B5)
- Locked audit trail; nothing editable post-lock without an attributed override (B6)
- Blind judging via bid codes (B7)
- A placement table the emcee can read from, plus per-team feedback export (B8)

Meets the §8.3 acceptance test, encoded in `e2e/scoring.spec.ts`: 8 teams, 3 judges, phones, locked auditable placements, reproducible.

**B6 was still only half true in July 2026**, and again the gap was in the code rather than the design. `lockResults` rebuilt its inputs from the live tables on *every* call, overrides included — so a correction re-derived the world instead of replaying the frozen snapshot, and anything written since the lock entered it silently. Nothing in the audit trail could show that: each run reproduces from its own row, so two runs built from different worlds both verify. The board's own "no deduction — re-tabulate only" correction, which is supposed to be a no-op, reordered every placement. An override now replays the superseded run's frozen `inputs` and `config` and appends only the deduction it was given; a score arriving after the lock enters no run at all, and the board is told so rather than left to find out from the placements. `e2e/late-score.spec.ts` fails on the old behaviour. Alongside it, the `teamId`-is-a-claim check — which the database cannot enforce, because every team FK is bare — turned out to be missing from `addDeductionAction`, where a dropped team and a stale dropdown were enough to write a penalty that was silently never applied; it now has one definition and `e2e/scope.spec.ts` holds it. `db:doctor`'s failure branches are exercised against a database actually in each broken state, not just its pure verdict function. And board links became revocable ([ADR-0011](decisions/0011-nothing-mints-a-link.md)) — `board_assignments.revoked_at` had been read since ADR-0007 and written by nothing, so a leaked board link could override a locked result and could not be killed from the product.

**B6 and B8 were only half true until earlier in July 2026**, and the gap was in the code rather than the design. The override wrote `supersedes_id` and `override_reason` but no form ever reached it; `locked_by_person_id`, `deductions.created_by_person_id`, and `audit_log.actor_person_id` were null in every row, because a board token authorized a comp and not a person. Judge links were unrevocable in practice. There was no export of any kind, and `scores` had no text column, so judge feedback was not half-built — it was unrepresentable. All four are closed: board links are per person ([ADR-0007](decisions/0007-board-links-are-per-person.md)), a correction applies an attributed deduction and supersedes the prior run, judges can be revoked from the board screen, and `judge_notes` feeds an emcee sheet and a feedback CSV. Covered by `e2e/override.spec.ts`, `e2e/revoke.spec.ts`, and `e2e/feedback.spec.ts`.

## v1 — "the part that bleeds money" (on ≥3 signed founding partners)

Ship target: live for the **January–March 2027** season.

**Module A — Registration + Payments.** The spine, and the treasurer's pain.

> **A1 and A2 shipped in July 2026 and the money spine followed on July 31 – August 1**, all of it before this gate cleared, at the founder's direction and against the PRD's own advice. That is recorded rather than tidied away. **The line now holds at Stripe** (A5–A5c): the ~$5,000 gap is closed by the *ledger* on hand-entered `rail: 'venmo'` rows, so routing buys ingestion rather than correctness, and whether a student board wants card rails is a question for the founding partners. Everything else below is still gated, and Track 1 is still 0/10 conversations and 0/3 signatures.

- ~~Configurable registration form; application → acceptance → waitlist workflow (A1, A2)~~ — **shipped July 2026, ahead of the gate.**
- ~~Roster and payment status joined by design (A3)~~ — **shipped July 31, 2026**, ahead of the gate. `charges` landed in migration `0009`.
- Team submission portal for post-acceptance materials (A4) — blocked on a third actor kind and a link-minting path ([ADR-0011](decisions/0011-nothing-mints-a-link.md)), which is a decision rather than an oversight
- Stripe Connect Standard, ACH-first, nonprofit rate, optional surcharge (A5, A5a–c) — **where the line now holds**
- ~~Fee schedule engine; exact per-team totals (A6)~~ — **shipped July 31, 2026.** Pure and ESLint-fenced; `asOf` is passed in
- ~~Refunds and deposit state (A7)~~ — **shipped August 1, 2026** as an append-only `deposit_events` chain with a terminal index, driven from the board's deposit table. ~~Receipts~~ followed on **August 4, 2026** once the comms engine had a caller: two templates rather than one, because a returned deposit is not a receipt with a minus sign in it. There is deliberately **no forfeit notice** — a forfeit moves no money and is a sentence a person should say
- ~~Fee-aware gross/net ledger (A8)~~ — **shipped August 1, 2026**, including attaching a lump to obligations that did not exist when it arrived
- ~~One-screen dashboard: applied / accepted / paid / outstanding (A9)~~ — **shipped August 1, 2026**
- ~~One-click reminders to late payers (A10)~~ — **written August 3–4, 2026** and merged. Not yet `Live`: nothing has been sent from the deployed database, which has no sending credential on it
- Google Drive import as the on-ramp (A11)

See [PAYMENTS.md](PAYMENTS.md) and [DATA_MODEL.md](DATA_MODEL.md) — both are already written.

**Module B — Tabulation.** Already built. What v1 adds: real board accounts, per-team feedback export, judge feedback delivery.

## Adjacent tier — nearly free, reads the same record

- ~~Judge feedback delivery~~ — **written August 4, 2026**, one button per locked run; merged, not yet sent from production. ~~Per-team score export~~ — shipped with Module B
- ~~Public read-only info page~~ — **shipped July 31, 2026**
- Food timing (the hospitality slice already living in the Gita)

## Spine completion — after paying customers exist

- **Gita + comp-day mode.** The highest-value hard problem (PRD §9). The existing spreadsheet is a compiler; the missing product is the runtime. The one new capability is G3: a single "running N minutes behind" input that re-derives the whole cascade — the cell that does not exist today.
- Liaison and volunteer coordination; SWA-training checklist
- ~~Comms engine: announcements and pushes, firing off the same record~~ — **the engine landed August 3, 2026 and its callers on August 4–5**: dues reminders, receipts, the invitation, announcements, feedback delivery. Not yet `Live`; sending is opt-in on a key and a from-address that production does not have. The Gita's push-on-change (G5) is the same engine with a different trigger, and stays gated with the Gita

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
