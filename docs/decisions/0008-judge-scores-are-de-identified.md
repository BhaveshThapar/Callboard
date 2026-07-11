# ADR-0008 — Blindness runs both ways: a judge's scores carry a label, not a name

**Status:** accepted · July 11, 2026
**Related:** [ADR-0007](0007-board-links-are-per-person.md), which is this decision's mirror image — it made the *board* less anonymous for the same reason this makes the *judge* more so.

## Context

PRD B7 promises blind judging, and delivers it: `JudgeTeamView` has no `name` field, so leaking a team's name to a judge is a compile error rather than a code review someone has to pass.

There was no reciprocal projection. PRD §7 said *"board sees everything,"* and the code took it literally:

- `GET /board/[token]/feedback` emitted a CSV whose `Judge` column was the judge's **real name**, beside their raw score on every criterion and their verbatim written note.
- DEMO.md step 9 scripted handing that file to the teams.
- An e2e test asserted `expect(csv).toContain(judge.name)`, and a unit test asserted the rows were sorted by judge name. The wrong behavior was pinned down by the test suite.

So a team could read which named judge scored it lowest and what that judge wrote about it. In this circuit judges are alumni, friends of teams, and people who will be asked back next year. A judge who can be named next to a number is a judge who scores the number they can defend at the afterparty, which is precisely the failure the blind-judging half of B7 exists to prevent. Blindness was enforced in the direction that was easy to see and absent in the direction that costs a comp its judging panel.

A board raised it on a demo call on July 11, 2026 as a condition of buying.

## Decision

Two lines, both enforced by the shape of a type rather than by a filter somebody remembers to write.

**1. The board may see who its judges are and whether they have submitted. It may never see what any *named* judge entered.** The roster sidebar keeps `BoardJudgeView` and its `name`: the board recruited these people, sends them their links, revokes them, and chases the slow ones. Every surface carrying a score or a note instead takes `JudgeLabelView` — `{ assignmentId, label }`, with no `name` field, so `people` is not joined at all. The name is not withheld downstream; it is never fetched.

Progress is not content. "Priya Raghavan · 4/8" stays. "Priya Raghavan · 27" cannot be written.

**2. A team may never see a score — its own or anyone else's.** Teams get their placement, their deduction and the reason recorded against it, and each judge's written note under `Judge 1` / `Judge 2`. Publishing the numbers invites a team to litigate a 27-vs-28 on Execution, an argument no board can win and no rubric can settle.

The one export therefore becomes two:

| | Audience | Carries |
|---|---|---|
| `GET /board/[token]/feedback?team=<bidCode>` | forwarded to one team | placement, deduction + reason, notes. **No scores.** |
| `GET /board/[token]/scores` | the board, never forwarded | the per-criterion breakdown under `Judge N` |

`?team=` is required. The unfiltered route handed the board a single file containing every team's feedback, which is one careless forward from sending a team its rivals' notes.

`TeamFeedbackInput` takes a `scoredBy: ReadonlySet<string>` — membership of the (judge, team) pairs that were scored, carrying no values — so the builder cannot emit a raw score even by accident: it never holds one.

**The label is persisted, not derived.** `judge_assignments.label_seq`, unique per comp. Both obvious derivations are wrong. Numbering by judge name is invertible — a board that recruited three judges can sort them alphabetically in its head — and the old export sorted by name, so the fake anonymity would have been trivially undone. Numbering by a sort over assignment UUIDs silently renumbers the whole panel the moment a replacement judge is added mid-comp, which would make "Judge 2" mean a different person than it meant in yesterday's sheet. For a product whose entire claim is that a locked result reproduces a day later, a label that quietly reassigns itself is the same defect as a score that quietly changes.

Nothing in `src/lib/tabulation/` moves. `TabulationInput` keeps `judgeId`, `tab_runs.inputs` keeps the fully judge-attributed frozen snapshot, and `audit_log` keeps `actor_person_id`. The record stays complete; only the projection of it is labelled. `reproducibility.test.ts` is untouched.

## Consequences

**Good.** A judge can score honestly. A board can still audit the arithmetic and spot the judge who scored a team far off the other two — it just cannot learn which of its judges that was. A team gets feedback that is about its dancing rather than about its numbers. And the leak is now unrepresentable: putting a name back into an export fails `tsc`, not a test.

**The cost.** A board that genuinely needs to know which judge is systematically harsh — to not invite them back — cannot get that from Callboard. That is deliberate. A panel where the board can profile individual judges is a panel that scores politically, and the board can watch a judge in the room if it wants to.

DEMO.md loses its old step 9 (handing over a CSV of names and numbers) and gains a better one: the board can *prove* the placement is right from the locked snapshot without publishing a score sheet the team will argue with line by line. That is a stronger answer to "what do you send the captain," not a weaker one.

**The migration.** `label_seq` is added nullable, backfilled by creation order per comp, then made `NOT NULL` — a bare `ADD COLUMN ... NOT NULL` aborts on any seeded comp. The backfill's ordering is arbitrary but permanent, which is the property that matters.

## When this changes

If a league (Origins, NDDL) requires judge-attributed score sheets for bid-point reporting, that is a league-facing export, not a board-facing one, and it gets its own actor and its own ADR. It does not reopen the board's view.
