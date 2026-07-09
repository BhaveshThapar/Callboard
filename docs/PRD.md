# PRD — Callboard

*The operating system for a collegiate competition weekend.*

| | |
|---|---|
| **Author** | Bhavesh Thapar |
| **Status** | Draft · pre-build (presell gating in progress) |
| **Version** | 0.1 |
| **Last updated** | July 9, 2026 |
| **Working name** | Callboard *(naming open — see §13)* |

---

## 1. Summary

Callboard is a single system of record for running a collegiate dance competition weekend: team registration and payments, judge scoring and tabulation, the run-of-show schedule (the "Gita"), liaison and volunteer assignments, and the announcements that tie them together. Today every comp runs this on a stack of Google Forms, a shared Gmail account, Venmo, GroupMe, and a spreadsheet held together by one exhausted treasurer. Callboard replaces the spreadsheet-and-Venmo core with one record that many roles read through filtered views, and one comms engine that pushes off the same data.

The wedge is narrow and deliberate: **registration + payments** and **tabulation** — the two places where money and trust are on the line. Everything else is roadmap.

This is being built founder-first. The author is a two-year board member and current Treasurer at Maryland Mayuri (UMD), and the requirements below are grounded in a forensic teardown of Mayuri's own 2025–26 financial and scheduling records, cited throughout.

---

## 2. Problem

### 2.1 The circuit

The collegiate desi dance circuit runs roughly 90–120 competitions a year across fusion, classical, Bhangra, and raas/garba, each hosted by a student org and drawing teams that travel nationally. Two leagues now formalize the fusion side (NDDL, Legends) with ELO rankings and centralized team–competition matchmaking; the classical side runs its own league entity (Origins) with a common application and standardized judging. Each comp moves real money — registration fees, hotel fees, tickets, sponsorships — through consumer payment apps and a treasurer's personal accounting.

**The org structure is a de facto standard.** Two independent orgs examined (Maryland Mayuri and Maryland Minza) share the same eleven-committee structure — Registration, Finance, Logistics, Hospitality, Tech, Mixer, PR, Liaison, External, Social. This convergence is the core product insight: a schema that encodes a comp weekend is reusable across every comp on the circuit without per-org customization.

### 2.2 The three pains

Every pain below is documented in Mayuri's own files (Feb 23, 2026 comp; 8 teams). See §14 for the full evidence base.

**Pain 1 — Money reconciliation is manual, multi-rail, and wrong.**
Team money lands on Venmo (@Maryland-Mayuri) and is manually shuttled to an M&T bank account in nine separate transfers over the season, several at exactly $4,999 (structuring under an apparent cap). Zelle leaks alongside it to the treasurer's personal phone number. The fee schedule ($70/dancer + $140/room + $100 refundable deposit + late fees) means every team owes a different total, so a single lump payment — e.g. NCSU's $2,160 "hotel, security deposit & reg fees" — has to be hand-unbundled into three ledger lines. Card fees silently desync the ledger from cash (a $100 deposit arrived as $97.01). The result: the org's own season-summary sheet records a net of **$2,837.47** next to a hand-typed note reading *"true amount around 8k."* The official ledger disagrees with reality by ~$5,000, and the board knows.

**Pain 2 — Tabulation is physical, single-copy, and unauditable.**
Judges score on paper clipboards. Scores are finalized in a deliberation room under a 20-minute cutoff (with an institutionalized white lie: tell judges 20 minutes when the schedule actually holds 30). The paper is turned into placements by an unspecified manual process, and the emcee hand-writes the results into their own script. There is no audit trail. If a team demanded to see the math the next day, the honest answer is that the score sheets are in a folder in someone's apartment, if they weren't recycled. Every comp carries this dispute risk with no paper trail to survive a real challenge.

**Pain 3 — The schedule is a compiler, not a runtime.**
The run-of-show ("Gita") is a genuinely sophisticated spreadsheet engine: a single input (the show order, drawn Friday night) drives chained `TIME()` formulas that derive every team's walk-start → lobby → stretch → props → tech-in/out, then hand-compiles into ~30 per-person board columns at 15-minute resolution. Friday night it is beautiful. But Saturday, when the show runs behind, there is no cell to type the delay into — a human re-derives the entire cascade across a six-room matrix, the food shifts, the judge cutoffs, and the transport departures, then broadcasts it by mouth and GroupMe while every printed and open copy goes silently stale. The board's own words for comp day: *"very stressful,"* and *"people in the schedule don't know what to do."* The single attempt at a live-recalculating version is a tab borrowed from another comp whose original author left a surrender note in a cell: *"idk how to buffer this for teams 1…"*

### 2.3 Why the market is real and underserved

- **Demand is saturated.** Mayuri's 2026 registration shows **38 teams applied for 8 slots** — a 4.75× oversubscription — with an anonymized bid-code system for blind judging. The circuit is large, formalized, and demand-constrained.
- **Incumbents serve the wrong circuit.** The studio-dance world is well-tooled (DanceComp Genie, DanceBUG, TourPro, Competition Track at $299–$1,499+/event). None speak collegiate desi: video-audition team selection, waitlist promotion, liaison assignments, bid-point/ELO reporting to a league, mixers, hotel blocks, and a buyer that is a broke student board turning over every May.
- **Institutional memory evaporates annually.** Boards fully turn over each spring and lose their operating knowledge. Callboard's retention story is that the system *remembers* last year's judges, budgets, timelines, and vendors. Evidence: Mayuri's own workbooks are inherited copies of other comps' files, fossil sheets and apologies included — copying each other's spreadsheets is literally how knowledge transfers today.

---

## 3. Why now

- Boards for spring 2027 comps are forming and planning **right now**; registration windows open around September.
- Selling window is **August**, before the fall crush.
- The founder's access is at its peak: current Treasurer, two years of relationships, and the warmest possible intro list (captains of every team Mayuri hosted).

---

## 4. Users & buyers

**The buyer is not the primary user.** The buyer is a student board with ~$0 discretionary budget and annual turnover; the users are that board plus every team, liaison, and judge who touches the weekend.

| Persona | Role | Core need from Callboard |
|---|---|---|
| **Treasurer / Finance lead** | Buyer + power user | See who owes and who paid, on one screen, across rails; chase late payers; reconcile to the bank without hand-unbundling lumps. |
| **Registration lead** | Power user | Manage applications, acceptances, waitlist promotions; keep roster and payment status joined. |
| **Logistics / Event Ops lead** | Power user | Build the Gita from show order; adjust it live when the show slips; push the change to everyone. |
| **Director / President** | Oversight | One dashboard of money, roster, and readiness. |
| **Liaison / Volunteer** | Read-mostly | Know their assignments and their personal schedule; get pinged when it changes. |
| **Team captain** (visiting) | External user | Register, pay the exact amount owed, submit materials, see their own schedule. |
| **Judge** | External user | Score from a phone on the comp's rubric; feedback queue. |
| **Attendee** | Public read-only | General event info (what the brochure holds). |
| **League (Origins / NDDL)** | Partner / channel | Standardized, auditable tabulation and (aspirationally) a common-app feed. |

---

## 5. Goals & non-goals

### 5.1 Goals (v1)

1. Make "who owes what and who has paid" answerable on **one screen**, reconciled across rails.
2. Make tabulation **fast and dispute-proof**: judges score digitally, math runs itself, results in minutes, with a locked audit trail.
3. Be adoptable by a broke, non-technical board in **one weekend of setup**, importing what they already have.

### 5.2 Non-goals (explicitly out — the "tarpit")

These stay in the tools that already do them well. Saying no here is what makes the yes credible.

- **Design tooling** — flyers, logos, t-shirt/program layout → Canva / Figma. Not building a design tool.
- **Video editing** — hype/lineup videos → CapCut / Premiere.
- **The org's public website** → a separate build.
- **Mixer game-planning and decor** → human creative work. *Exception:* Callboard **ingests the show-order result** the mixer game produces (the one input the Gita needs) — it does not run the game.
- **Sponsorship CRM** → different data shape (sponsors ≠ teams), different user, and the existing spreadsheet works. A potential *separate product*, parked.
- **SGA budgets / grant paperwork** → university systems.
- **After-party ticketing** → a thin payment edge; note it, don't build it in v1.

### 5.3 Non-goals (strategic, for now)

- Not "all student orgs." The market boundary is *anyone who runs a competition weekend with visiting teams, judges, and a timed run-of-show.* A club without judges/liaisons/a Gita is out of scope.
- Not a startup-scale bet yet. Realistic ceiling (see §11) is a strong side business; it is gated on paid validation before build, and re-evaluated if signal exceeds expectation.

---

## 6. Strategy & product thesis

**One record, many windows, one comms engine.** (See the architecture diagram.)

- There is a single canonical **comp record**: People, Teams, Money, Schedule, Assignments.
- **Committees are readers/writers** of that record, not separate modules. Registration writes roster rows; Finance writes paid/owed against the same rows; Logistics writes the schedule that references the same teams.
- **Role-filtered views** expose slices: board sees everything; a team sees its own schedule and balance; a liaison sees assignments; a judge sees a scoring queue; an attendee sees public info.
- A **comms engine** sits on top and reads the same record: dues reminders fire off payment status, schedule pushes fire off the Gita, "you're up in 20" fires off show order. This is the keystone that fixes the stale-Gita problem — one edit re-times the cascade and re-pushes, instead of a human re-deriving by mouth.

**Build the intersection, not the union.** Horizontal across all comps works *because* only the shared spine is built. Every comp has Registration, Finance, Logistics, Comms — identical across them. All the variance lives in the tarpit (each org's merch, videos, mixer theme), which isn't built. The moat is the specificity of "competition weekend," not breadth.

**Beachhead → circuit.** Desi collegiate circuit first (where the founder has distribution), starting with Mayuri as customer zero, expanding comp by comp via warm intros, then across circuits (Bhangra, raas, classical).

**The league is both the threat and the cheat code.** Tabroom won high-school debate because the *league itself* ran it. If Origins/NDDL build this internally, it kills the customer base for that circuit; if Callboard becomes their official tabulation/common-app layer, it becomes the standard overnight. League conversations are therefore a first-order strategic input, not a side quest.

---

## 7. Scope & phasing

### 7.1 v1 — "the part that bleeds money" (build first)

Two modules on one record. This is the minimum that is worth $300 to a board.

**Module A — Registration + Payments** (the spine; the treasurer's pain)
**Module B — Tabulation** (the trust product; the demo)

Ship target: live for the **January–March 2027** comp season.

### 7.2 Adjacent tier (nearly free — reads the same record, build next)

- **Scoring extensions**: judge feedback delivery, per-team score export.
- **Public info page**: read-only brochure/general info view.
- **Food timing**: the hospitality slice that already lives in the Gita.

### 7.3 Spine completion (build after paying customers exist)

- **Logistics / Gita + comp-day mode** (see §9 — the highest-value hard problem).
- **Liaison & volunteer coordination**: assignments + SWA-training checklist.
- **Comms engine**: full announcement/push layer.

### 7.4 Later / separate

- League common-app feed (Origins/NDDL integration).
- After-party ticketing.
- Sponsorship CRM (likely a separate product).

---

## 8. Functional requirements — v1

### 8.1 Data model (the canonical record)

The record is comp-scoped and multi-tenant (many orgs, many comps per org, isolated).

- **Org** — name, brand, board roster, recurring settings; persists across years (the memory).
- **Comp** — an event instance under an org; date(s), venue, config, rubric, fee schedule.
- **Person** — name, phone, email, role(s); may be board, liaison, dancer, judge, attendee.
- **Team** — name, school, captain(s) & contacts, status (`applied` / `waitlisted` / `accepted` / `dropped` / `competing`), waitlist rank, roster size, division, bid code (anonymized).
- **Money** — per-team line items (registration, hotel, deposit, late fee), amount owed, amount paid, rail, timestamp, reconciliation status; card-fee-aware (gross vs. net).
- **Schedule** — show order → derived timings; tech times; per-person assignments (post-v1 for full engine, but the model is defined now).
- **Assignment** — person ↔ duty ↔ time; liaison/volunteer duties, SWA-training flag.
- **Score** (Module B) — judge ↔ team ↔ rubric criterion ↔ raw value ↔ deductions ↔ timestamp ↔ lock state.

**Permissions**: role-based row/field filtering is a first-class primitive, not an afterthought. Every external view is a filtered projection of the record.

### 8.2 Module A — Registration + Payments

**Registration**
- A1. Configurable registration form per comp: team info, roster, division, audition-video upload/link, waiver/liability acknowledgment, custom fields.
- A2. Application → acceptance → waitlist workflow, including **waitlist promotion** that automatically reconciles obligations (when an accepted team drops and a waitlisted team is promoted, balances and slots update — the exact failure mode that made "who's paid" unanswerable at Mayuri 2026).
- A3. Roster and payment status are **joined by design** (single record), eliminating the acceptance-doc-vs-Venmo split.
- A4. Team-facing submission portal for post-acceptance materials (final music, roster updates, emergency contacts).

**Payments**
- A5. **Stripe Connect** — each comp has its own connected account; funds flow directly to the org, never through Callboard, which never holds funds or touches the org's tax status. In Connect, Stripe's processing fee is borne by the connected account (the comp) — so fee incidence (A5a–A5c) is a first-class product concern, not an afterthought.
- A5a. **ACH-first routing for large payments.** Team registration/hotel payments are bank-transfer-style lumps ($600–$2,160 at Mayuri 2026), not impulse checkouts. Route them over ACH (0.8%, capped at $5) by default; anything above ~$625 hits the cap. This collapses the processing cost of an entire ~$11.5k season from ~$250+ (all-card) to roughly $60–80. Cards remain available for small items and last-minute payers.
- A5b. **Nonprofit rate configuration.** Most host orgs are 501(c)(3)s (Mayuri included — its determination letter is on file). Support the verified-nonprofit card rate (2.2% + $0.30 vs. 2.9% + $0.30) in the connected-account setup.
- A5c. **Optional fee pass-through (surcharge).** Per comp, allow the processing fee to be passed to the paying team, disclosed at checkout within card-network surcharge rules (≤3%, US). Default configurable; lets a comp net exactly what it charges. The paying dancer sees a "processing fee" line, as they already do everywhere else.
- A6. Fee schedule engine: per-dancer, per-room, deposit, late fee; computes each team's exact total so no lump needs hand-unbundling.
- A7. Automatic receipts and refund handling (deposits are refundable — the model must track deposit state cleanly; note ACH refunds and card refunds differ in timing and retained fees).
- A8. **Fee-aware ledger**: reconcile gross vs. net per rail (card fee, ACH cap, surcharge) so a $100 deposit arriving as $97.01 doesn't desync the books.
- A9. Live dashboard: applied / accepted / paid / outstanding, per team, one screen, rail-labeled.
- A10. One-click reminder to late/outstanding payers (replaces manual per-team texting).

**Migration on-ramp**
- A11. **Google Drive import** (one-directional, onboarding only): point Callboard at an existing comp folder, ingest roster and prior-year Gita. Kills the "we already have everything in Sheets" objection. *Drive is the on-ramp, never the backend.*

### 8.3 Module B — Tabulation

- B1. **Per-comp rubric configuration** — criteria and point weights differ by comp and circuit (fusion weights choreography/execution/musicality; classical uses different criteria entirely). Rubric is data, not hardcoded.
- B2. Judges score from **any browser on a phone** — no app install.
- B3. **Auto-normalization** — raw, Z-score, or rank-based (Buckeye Mela and others compute Z-scores by hand today).
- B4. **Deduction entry** — time penalties and other deductions.
- B5. **Live tabulation** with configurable **tie-break logic**.
- B6. **Locked audit trail** — every score timestamped; nothing editable after lock without a logged, attributed override. This is the dispute-proofing that paper cannot provide.
- B7. **Blind judging support** — bid codes / anonymized team identifiers (the circuit already does this; Origins uses it).
- B8. **Results output** — a clean placement result the emcee can read from directly (removing the hand-retype step), plus per-team feedback export.

**v1 acceptance test**: a board can run scoring for 8 teams and 3 judges, on phones, and produce locked, auditable placements in under ~5 minutes, with results reproducible the next day.

### 8.4 The one thing to build before selling

A **judge-scoring demo** — one weekend of build: fake teams, three "judges" on phones, live tabulation on screen. Everything else waits for deposits. The demo is the sales instrument; it makes the audit-trail pitch tangible.

---

## 9. Special spec — Gita / comp-day mode (post-v1, highest-value hard problem)

The Gita is a *compiler*: show order in, full schedule derived. The missing product is the *runtime*. The feature list can be read straight off the existing spreadsheet's buffer variables.

- G1. **Show-order ingestion** — accept the result of the Friday-night draw (the mixer game's output) as the single schedule input.
- G2. **Derivation engine** — reproduce the chained-timing logic (walk/lobby/stretch/props/tech-in-out; food distribution; judge cutoffs; transport departures) parameterized by named buffer variables.
- G3. **Live delay input** — *the core new capability*: a single "running N minutes behind" (per segment) input that re-derives the entire cascade — the cell that doesn't exist today.
- G4. **Per-person "now / next" views** — each board member, liaison, and team sees only their own re-timed timeline (replacing the ~30-column hand-compiled SATURDAY IND sheet).
- G5. **Push on change** — every recalculation pushes to affected phones via the comms engine, so no copy goes stale and "people in the schedule" always know what to do.
- G6. **Buffer awareness** — surface engineered slack (filler acts, exhibition padding, the 20-vs-30-minute judge buffer) so the operator sees what a delay actually consumes, and flag when *compound* delays exhaust it (the board's own stated breaking point).

---

## 10. Integrations

- **Stripe Connect** — payments; per-comp connected accounts; ACH-first with card fallback; nonprofit rate where applicable; optional surcharge pass-through; platform fee per §11 (card-volume-only or folded into flat — *not* a blanket 2%). *Prohibited surface: Callboard never holds funds or handles the org's tax status.*
- **Google Drive** — import/onboarding on-ramp and export target only.
- **Comms transport** — email + SMS/push for reminders and schedule changes (competing against GroupMe; see §12).
- **League feed (aspirational)** — Origins/NDDL common-app and bid-point reporting. Strategic; sequenced after 2–3 live comps.

---

## 11. Business model & unit economics

**The flat fee carries the revenue; the platform fee must not stack a blunt 2% on top of processing.** Once payments are done right (ACH-first + nonprofit rate), Stripe's own cut on an ~$11.5k season is ~$60–80 — so a blanket 2% platform fee (~$230) would be *larger than Stripe's* and would read to a treasurer as a ~4%+ blended rake. That loses deals. The fee is restructured accordingly.

- **Pricing**: **$300 flat per comp** for the founding season (the primary revenue line). Platform fee on payments is **modest and card-volume-only** (ACH is left at cost, since ACH is where the big lumps go) — or folded into a slightly higher flat fee. Target blended platform take **well under 1%** of processed volume, so the treasurer's total-cost math stays obviously worth it. Founding customers get white-glove tab-day support (founder on-call for the first three) and locked pricing.
- **Fee incidence**: processing (Stripe) is borne by the comp by default but can be passed to teams via surcharge (A5c). The comp can therefore net exactly what it charges — the honest answer to "won't we get less money."
- **Worked example (Mayuri 2026, ~$11.5k in team payments)**: ACH-first → Stripe ~$60–80; Callboard flat $300; card-only platform fee on the small card residue → a few dollars. The comp's *incremental* cost vs. today's "free" Venmo is the flat $300 plus <$100 of processing it can pass through — against elimination of a ~$5k reconciliation gap and personal-account freeze risk.
- **Per-comp revenue to Callboard**: ~$300–350 all-in at founding pricing.
- **Ceiling (honest)**: 20–25 comps across circuits ≈ **$8–12k/year** at founding flat pricing (lower than the earlier 2%-inflated estimate — that number was wrong). Studio-world pricing ($299–$1,499+/event) shows real headroom to raise the flat fee once the product is indispensable and multi-day/multi-circuit; student pricing is the near-term reality. This remains a side business, not a venture-scale outcome — and that framing is intentional and gated (§13).
- **Retention driver**: switching cost is *the whole weekend's brain lives here*, plus year-over-year memory that survives board turnover.

---

## 12. Risks & mitigations

| Risk | Why it bites | Mitigation |
|---|---|---|
| **Paper feels safe** | Boards tolerate physical scoring until a dispute blows up; tabulation is a "buy insurance before the fire" sell. | Lead the demo with the audit trail and a real near-dispute story; don't sell "nicer forms." Rank pains in discovery — money is a *last-month* pain, scoring a *someday* pain. |
| **League builds it** | Origins/NDDL running this internally kills the customer base for that circuit. | Talk to leagues early (learn, don't pitch); pursue official-tabulation-layer partnership as the winning path. |
| **GroupMe incumbent** | Comms/announcements have a deeply entrenched free tool. | Don't sell comms standalone; deliver it as the automatic output of the record (reminders/pushes boards can't easily replicate manually). |
| **Student-vendor credibility** | "Will this exist next year? You're a student." | White-glove founding support (founder on-site/on-call); data exportable from day one (worst case: back to Sheets, with better Sheets). |
| **Annual turnover** | The buyer disappears every May. | Reframe as the *retention* moat: the system is the institutional memory the outgoing board can't hand off otherwise. |
| **Scope creep to an ERP** | Eleven committees tempt eleven modules — the everything-app failure mode. | Hard spine/adjacent/tarpit discipline; v1 is exactly two modules; the org chart is the vision slide, not the build list. |
| **Reconciliation trust** | If the ledger is wrong, the product's core promise fails. | Card-fee-aware, rail-aware reconciliation as a first-class requirement (A6/A8); the $2,837-vs-$8k gap is the exact failure being eliminated. |

---

## 13. Success metrics

**Product (per comp, v1)**
- Time to answer "who owes what / who has paid": target **< 1 minute** (from hours of reconciliation).
- Reconciliation error vs. bank: target **$0** (from ~$5k at Mayuri 2026).
- Tab-day time from last score to locked placements: target **< 5 minutes**.
- Next-day reproducibility of results: **100%** (from "in a folder, maybe recycled").
- Setup-to-live for a new board: target **≤ one weekend**.

**Venture (the presell gates — go/no-go)**
- **10** board conversations across **3+** circuits by **Sept 15, 2026**.
- **3** paid, refundable-until-January deposits.
- League check (Origins/NDDL) complete.
- ≥3 deposits → build Sept–Dec, ship for Jan season. <3 after 10 real conversations → hobby build for Mayuri/Minza only; stop counting it as a business.

---

## 14. Evidence base (appendix)

All findings from the founder's own Mayuri 2025–26 financial and scheduling records; the Feb 23, 2026 comp had 8 competing teams.

- **Rail & structuring**: Venmo → M&T Bank in 9 manual transfers ($21,888.58 total; several at exactly $4,999). Zelle leakage to the treasurer's personal number.
- **Fee schedule**: $70/dancer + $140/room + $100 deposit + late fees → every team owes a different total.
- **Reconciliation pain**: NCSU's $2,160 lump ("hotel, security deposit & reg fees") required manual 3-way unbundling; BU Dheem's $100 deposit landed as $97.01 (card fee).
- **Roster churn**: between the December acceptances doc and the February show, 2 accepted teams dropped (RU Natya, UCSD Pushpanjali) and 2 waitlisted teams were promoted (BU Dheem, NSU Veera) — the source of unreconciled obligations.
- **The kill exhibit**: season-summary sheet nets **$2,837.47** beside a hand-typed note, *"true amount around 8k."* The 2025–26 "current tracker" tab has a single entry before dying.
- **Demand**: **38 teams applied for 8 slots** (4.75× oversubscription); anonymized bid-code blind-judging system in use.
- **Tabulation**: physical clipboards; deliberation-room 20-min cutoff (told to judges) vs. 30-min real; emcee hand-writes results; no audit trail.
- **Gita**: single-input show-order compiler with chained `TIME()` derivations and ~30 hand-compiled per-person columns; no live-delay input; inherited from another comp's workbook (surrender note preserved in a cell).
- **Org structure**: Mayuri and Minza share the identical eleven-committee structure → schema generalizes.

---

## 15. Open questions

**Answerable only by human interviews (not in any file):**
- **Compound-delay story** — the concrete moment buffers were exhausted (owner: Event Ops / a Director).
- **Exact paper-to-placement method** — calculator? sheet? consensus? — and any real dispute or near-dispute (owner: Judging).
- **Origins mechanics** — what the common app actually is (form? site?), what it handles, where it stops, and what Origins standardizes in the deliberation room (judges? rubric? just the app?).
- **The Claude-for-finance workflow** the board already tried — what was pasted in, what it got wrong, how the error was caught (informs whether an AI reconciliation assist belongs on the roadmap).

**Product decisions open:**
- **Naming.** Working name *Callboard* (theater term for the backstage board where the stage manager posts schedule, sign-in, and notices — conceptually exact). Alternatives to weigh: *Green Room*, *Showrunner*, *Bidpoint*, *Circuit*.
- Depth of league integration to design for in v1 vs. defer.
- Whether after-party ticketing is worth a thin v1 payment edge.

---

*Next: validate against the §13 gates before building anything beyond the scoring demo.*