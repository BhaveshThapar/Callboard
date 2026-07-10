# Running the demo

This is the sales instrument (PRD §8.4). It should take five minutes and it should be run on other people's phones, not yours.

## Setup, once

```bash
bun install
cp .env.example .env.local     # DATABASE_URL from your Neon project
bun run db:migrate
```

## Which database

Three Neon branches, and the demo runs on exactly one of them.

| Branch | Who points at it | Wiped by |
|---|---|---|
| `main` | the deployed app — **this is the demo** | only you, on purpose |
| `ci` | GitHub Actions | every push to `main` |
| `dev` | your `.env.local` | every local `bun run e2e` |

`bun run db:seed` with no override hits `dev`, which is not what a prospect is looking at. Seeding the demo means naming production explicitly, below. The split exists because seeding deletes the demo org and everything cascading from it — before the branches were separated, a merged pull request could 404 three judges' phones mid-call.

That split is now enforced rather than agreed to: `e2e/guard.ts` refuses to run the suite against the compute backing `main`, whoever points `DATABASE_URL` there, and CI reads its own `CI_DATABASE_URL` secret so the demo's connection string is never in its environment.

## After deploying, reseed once

Migration `0002` drops `comps.board_token_hash`, so **any comp seeded before it has no board link** — the judges' links still work, the board's does not. There is nothing to migrate: a board link is now a person, and the old token named nobody. Reseeding mints one. This is a one-time cost of [ADR-0007](decisions/0007-board-links-are-per-person.md), and reseeding before a call is the normal flow anyway.

## Before the call

```bash
DATABASE_URL='<neon main pooled>' \
NEXT_PUBLIC_BASE_URL='https://<your-app>.vercel.app' \
  bun run db:seed
```

A leading environment variable wins over `.env.local`, so nothing needs editing. This wipes and reseeds the demo comp — Mayuri 2027, eight competing teams, three judges, a four-criterion fusion rubric normalized by z-score with a head-to-head tiebreak — and prints four links:

```
Board (open on a laptop):
  Ananya Krishnan  https://.../board/<token>

Judges (one per phone):
  Priya Raghavan   https://.../judge/<token>
  Arjun Mehta      https://.../judge/<token>
  Sonia Desai      https://.../judge/<token>
```

The raw tokens are shown exactly once. Only their sha256 is stored. Text the judge links; open the board link on the laptop you are screen-sharing.

The board link carries a name because it belongs to a person, not to the comp. That is what lets a lock and a correction be attributed to a human (PRD B6, [ADR-0007](decisions/0007-board-links-are-per-person.md)). Add board members in `comp-config.json` and each gets their own link.

Reseeding at any point gives you fresh links and a clean comp.

## Running it with their rubric

If a board asks *"can we try it with ours?"* — say yes on the call, and do it afterward. Copy `comp-config.example.json`, fill in their criteria, weights, normalization, tiebreakers, teams, bid codes, and judges, then:

```bash
DATABASE_URL='<neon main pooled>' bunx tsx src/db/seed-cli.ts --config their-comp.json
```

It seeds its own org and cascades independently, so it cannot disturb the Mayuri demo. All three normalizations (`raw`, `zscore`, `rank`) and all three tiebreakers (`criterion`, `head_to_head`, `highest_single_judge`) are supported.

This is a founder-run script, not a setup screen, and that is deliberate (PRD §12: white-glove founding support). Setup UI waits for deposits.

## The five minutes

**1. Hand out three phones.** No app, no account, no password. The link is the credential. This is the first thing people notice.

**2. Point at the bid codes.** Each judge sees `A-114`, not `NCSU Nazaare`. Say plainly: the judge's view does not select the team name from the database. Blind judging is not a setting someone can forget to turn on.

**3. Have them score.** Four criteria per team, whole numbers. The board screen updates every two seconds — `12 / 96 scores`, then `40 / 96`, then `96 / 96`. Nobody is reading numbers off a clipboard to anyone.

**4. Apply a deduction.** Pick a team, `2` points, "exceeded time limit by 14s." Watch the standings move. Mention that the penalty is applied to every judge's total before normalization, because a z-score is measured in standard deviations and you cannot subtract two points from a standard deviation. People who judge for a living notice this.

**5. Lock.** Names replace bid codes. Placements are final. The clock from last score to locked placements is the number PRD §13 promises to keep under five minutes.

**6. Point at "✓ Snapshot reproduces."** This is the whole pitch. The lock froze the scores, the rubric, and the results into one row. That green check is the app re-running the tabulation against the frozen inputs, right now, and getting the same answer. It will get the same answer next February.

**7. Scroll to the audit trail.** Every score, deduction, and lock — timestamped, and attributed to a name. Not "board." *Ananya Krishnan.* The board link belongs to a person, so the record knows which human did each thing.

**8. Let them ask "but what if the math was wrong?"** They will. This is the question the whole product answers, so do not rush it.

Fill in the correction box: `Time penalty for NCSU was missed during scoring`, deduct `2` from NCSU, re-lock. Then say what just happened, slowly:

- The placements moved. A correction that cannot change anything proves nothing.
- **Nothing was edited.** The first run is still in the database, with its own frozen inputs, still reproducing. Run 2 supersedes run 1; it does not replace it. Scores are immutable after a lock — a correction is a new deduction and a new tabulation, never a rewritten score.
- The new run carries a name and a written reason, and the audit trail shows `tab.override`.

Paper cannot do this. A spreadsheet cannot do this, because a spreadsheet's history is whoever last hit save.

**9. Now ask the question that closes:**

> If a team's captain emails you tomorrow asking to see the math, what do you send them today?

The honest answer is that the score sheets are in a folder in someone's apartment, if they weren't recycled. Then answer it yourself: click **Emcee sheet** (print it, or save it as a PDF) and **Download feedback CSV** — every judge's score on every criterion, plus what each judge wrote to that team, read straight from the frozen snapshot.

**Aside, if a judge's link comes up.** Any judge can be revoked from the board screen mid-comp. The link stops opening; their scores stand and still count. Revoking is not a retraction.

## What to say when they push back

**"Paper works fine."** It does, until it doesn't. This is insurance sold before the fire. Do not argue that the forms are nicer — ask whether they have ever had a team question a placement, and watch what happens in the room. Rank the pains: money is a last-month pain, scoring is a someday pain.

**"You're a student. Will this exist next year?"** Data exports from day one — not a promise, a button: show them the feedback CSV you just downloaded. Worst case they end up back in Sheets, with better Sheets. Founding customers get the founder on-call for tab day.

**"Our league might build this."** Good — introduce me. If Origins or NDDL wants an official tabulation layer, that is the best outcome on the board, not the worst.

**"What about payments?"** Not built, and deliberately. Point at [PAYMENTS.md](PAYMENTS.md), which costs nothing to show and demonstrates that the hard part — gross vs. net, unbundling a lump payment, ACH-first routing — has already been thought through. Then ask for the deposit that unlocks it.

## Afterward

Reseed before the next call. The demo comp is disposable on purpose.
