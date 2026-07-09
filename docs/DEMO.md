# Running the demo

This is the sales instrument (PRD §8.4). It should take five minutes and it should be run on other people's phones, not yours.

## Setup, once

```bash
bun install
cp .env.example .env.local     # DATABASE_URL from your Neon project
bun run db:migrate
```

## Before the call

```bash
bun run db:seed
```

This wipes and reseeds the demo comp — Mayuri 2027, eight competing teams, three judges, a four-criterion fusion rubric normalized by z-score with a head-to-head tiebreak — and prints four links:

```
Board (open on a laptop):
  https://.../board/<token>

Judges (one per phone):
  Priya Raghavan   https://.../judge/<token>
  Arjun Mehta      https://.../judge/<token>
  Sonia Desai      https://.../judge/<token>
```

The raw tokens are shown exactly once. Only their sha256 is stored. Text the judge links; open the board link on the laptop you are screen-sharing.

Reseeding at any point gives you fresh links and a clean comp.

## The five minutes

**1. Hand out three phones.** No app, no account, no password. The link is the credential. This is the first thing people notice.

**2. Point at the bid codes.** Each judge sees `A-114`, not `NCSU Nazaare`. Say plainly: the judge's view does not select the team name from the database. Blind judging is not a setting someone can forget to turn on.

**3. Have them score.** Four criteria per team, whole numbers. The board screen updates every two seconds — `12 / 96 scores`, then `40 / 96`, then `96 / 96`. Nobody is reading numbers off a clipboard to anyone.

**4. Apply a deduction.** Pick a team, `2` points, "exceeded time limit by 14s." Watch the standings move. Mention that the penalty is applied to every judge's total before normalization, because a z-score is measured in standard deviations and you cannot subtract two points from a standard deviation. People who judge for a living notice this.

**5. Lock.** Names replace bid codes. Placements are final. The clock from last score to locked placements is the number PRD §13 promises to keep under five minutes.

**6. Point at "✓ Snapshot reproduces."** This is the whole pitch. The lock froze the scores, the rubric, and the results into one row. That green check is the app re-running the tabulation against the frozen inputs, right now, and getting the same answer. It will get the same answer next February.

**7. Scroll to the audit trail.** Every score, deduction, and lock, timestamped and attributed. Then ask the question that closes:

> If a team's captain emails you tomorrow asking to see the math, what do you send them today?

The honest answer is that the score sheets are in a folder in someone's apartment, if they weren't recycled.

## What to say when they push back

**"Paper works fine."** It does, until it doesn't. This is insurance sold before the fire. Do not argue that the forms are nicer — ask whether they have ever had a team question a placement, and watch what happens in the room. Rank the pains: money is a last-month pain, scoring is a someday pain.

**"You're a student. Will this exist next year?"** Data exports from day one. Worst case they end up back in Sheets, with better Sheets. Founding customers get the founder on-call for tab day.

**"Our league might build this."** Good — introduce me. If Origins or NDDL wants an official tabulation layer, that is the best outcome on the board, not the worst.

**"What about payments?"** Not built, and deliberately. Point at [PAYMENTS.md](PAYMENTS.md), which costs nothing to show and demonstrates that the hard part — gross vs. net, unbundling a lump payment, ACH-first routing — has already been thought through. Then ask for the deposit that unlocks it.

## Afterward

Reseed before the next call. The demo comp is disposable on purpose.
