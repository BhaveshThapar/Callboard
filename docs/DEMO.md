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

`bun run db:seed` with no override hits `dev`, which is not what a prospect is looking at. Seeding the demo means naming production explicitly, below. The split exists because seeding deletes the demo comp and everything cascading from it — before the branches were separated, a merged pull request could 404 three judges' phones mid-call.

That split is now enforced rather than agreed to: `e2e/guard.ts` refuses to run the suite against the compute backing `main`, whoever points `DATABASE_URL` there, and CI reads its own `CI_DATABASE_URL` secret so the demo's connection string is never in its environment.

## After deploying, reseed once

Migration `0002` drops `comps.board_token_hash`, so **any comp seeded before it has no board link** — the judges' links still work, the board's does not. There is nothing to migrate: a board link is now a person, and the old token named nobody. Reseeding mints one. This is a one-time cost of [ADR-0007](decisions/0007-board-links-are-per-person.md), and reseeding before a call is the normal flow anyway.

To catch exactly this without wiping anything, run the read-only preflight against the deployed demo:

```bash
DATABASE_URL='<neon main pooled>' bun run db:doctor
```

It confirms a board link *and* a judge link resolve and that both the board and the judge views render — the judge view reads `judge_notes`, a table the board view never touches, so a drift there would 500 every phone while the board stayed up. It also confirms every judge has a `Judge N` label, which only the exports read: a comp seeded before `label_seq` existed renders a perfectly healthy board screen and then fails at the download, mid-call. Then it prints `✓ Demo healthy` or a `✗` naming what to reseed, exiting non-zero on failure. It only reads, so — unlike `db:seed` and `bun run e2e`, which the guard refuses against `main` — it is safe to point at the live demo.

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

The seed proves each of these links resolves against the live schema before printing them, so a clean `db:seed` is itself the health check — a seed that cannot mint a working board *or* judge link fails loudly instead of handing you a dead one. If you forget the `NEXT_PUBLIC_BASE_URL` above, the links fall back to `localhost` and the seed prints a `⚠` saying so — localhost links open on your laptop and 404 on a phone. Run `db:doctor` any time afterward to re-confirm without reseeding.

The board link carries a name because it belongs to a person, not to the comp. That is what lets a lock and a correction be attributed to a human (PRD B6, [ADR-0007](decisions/0007-board-links-are-per-person.md)). Add board members in `comp-config.json` and each gets their own link.

Reseeding at any point gives you fresh links and a clean comp.

## Running it with their rubric

If a board asks *"can we try it with ours?"* — say yes on the call, and do it afterward. **Do not treat this as a favour: it is the ask.** Send them [INTAKE.md](INTAKE.md), which is written to be forwarded to a treasurer, and what comes back is Part 1 of the three things a founding partner owes you. Copy `comp-config.example.json`, fill in their criteria, weights, normalization, tiebreakers, teams, bid codes, and judges, then:

```bash
DATABASE_URL='<neon main pooled>' bunx tsx src/db/seed-cli.ts --config their-comp.json
```

It seeds its own org and cascades independently, so it cannot disturb the Mayuri demo. All three normalizations (`raw`, `zscore`, `rank`) and all three tiebreakers (`criterion`, `head_to_head`, `highest_single_judge`) are supported.

**If they run divisions, give each one its own `comp.slug` under the same `org.slug`.** A comp is one division ([ADR-0010](decisions/0010-a-comp-is-one-division.md)), so two divisions are two comps — two configs, two seeds, a board screen and a judge panel each. Seeding the second does not disturb the first, and the same tab chair can sit on both and get a link per comp ([ADR-0012](decisions/0012-a-seed-replaces-a-comp-not-an-org.md)). What you must not do is reuse the same `comp.slug`, which is a reseed of that comp rather than a second division.

**Seeding the same comp a second time will refuse, and should.** Once their links are out, a reseed replaces that comp and reissues every token — so the link on their treasurer's phone quietly stops resolving. The first seed creates and is safe; a reseed destroys and is not. Only the named comp is at stake: a *different* `comp.slug` under the same org creates, and does not fire the refusal. If you really do need to rebuild the comp, `--force` and then hand out the new links yourself.

This is a founder-run script, not a setup screen, and that is deliberate (PRD §12: white-glove founding support). Setup UI waits for three signed founding partners.

## Before you open the laptop

Ten minutes of discovery, and **do not demo during it.** The demo is a credential, not a discovery tool: it proves a student can ship rigorous working software, which is the objection in PRD §12 you cannot argue your way past. What it does *not* do is find the pain, because scoring is not the pain. PRD §2.3 ranks payments as *the* pain and scoring as a *someday* pain, and every board so far has said so unprompted.

So ask about money first, and ask about the last comp, not the next one:

- Walk me through how you knew who had paid last season.
- What did your ledger say at the end of the year, and what did the bank say?
- Who chased the teams that hadn't paid, and how?
- Has a team ever questioned a placement?

You are listening for their version of the $2,837-vs-"true amount around 8k" gap in [PAYMENTS.md](PAYMENTS.md). Let them say it. It is far stronger out of their mouth than yours, and it tells you whether this is a real prospect or a polite one.

Then demo. **Ask for their rubric before the call** and pre-seed it (see above) — a board that bothers to send you their criteria is qualifying itself, and their four criteria with their tiebreak land differently than Mayuri's.

## The five minutes

**1. Hand out three phones.** No app, no account, no password. The link is the credential. This is the first thing people notice.

**2. Point at the bid codes.** Each judge sees `A-114`, not `NCSU Nazaare`. Say plainly: the judge's view does not select the team name from the database. Blind judging is not a setting someone can forget to turn on.

**3. Have them score.** Four criteria per team, whole numbers. The board screen updates every two seconds — `12 / 96 scores`, then `40 / 96`, then `96 / 96`. Nobody is reading numbers off a clipboard to anyone.

**4. Apply a deduction.** Pick a team, `2` points, "exceeded time limit by 14s." Watch the standings move. Mention that the penalty is applied to every judge's total before normalization, because a z-score is measured in standard deviations and you cannot subtract two points from a standard deviation. People who judge for a living notice this.

**5. Lock.** Names replace bid codes. Placements are final. The clock from last score to locked placements is the number PRD §13 promises to keep under five minutes.

**6. Point at "✓ Snapshot reproduces."** This is the whole pitch. The lock froze the scores, the rubric, and the results into one row. That green check is the app re-running the tabulation against the frozen inputs, right now, and getting the same answer. It will get the same answer next February.

**7. Scroll to the audit trail.** Every score, deduction, and lock — timestamped, and attributed to a name. Not "board." *Ananya Krishnan.* The board link belongs to a person, so the record knows which human did each thing.

**8. Click "Download score breakdown," and say what is missing from it.** Every judge's score on every criterion — under **Judge 1, Judge 2, Judge 3**. The board can see that one judge scored a team fifteen points below the other two. It cannot see *which of its judges that was*, and neither can anyone else, because the export does not join the name — it never reads it.

> Blindness runs both ways. Your judges can't see who they're scoring, and you can't see who scored what.

Say why: a judge who can be named next to a number scores the number they can defend at the afterparty. Alumni judge these comps. They get asked back. Anyone who has recruited a panel knows exactly what this is protecting them from — and it is the one thing on this screen a spreadsheet cannot even attempt.

**9. Let them ask "but what if the math was wrong?"** They will. This is the question the whole product answers, so do not rush it.

Fill in the correction box: `Time penalty for NCSU was missed during scoring`, deduct `2` from NCSU, re-lock. Then say what just happened, slowly:

- The placements moved. A correction that cannot change anything proves nothing.
- **Nothing was edited.** The first run is still in the database, with its own frozen inputs, still reproducing. Run 2 supersedes run 1; it does not replace it. Scores are immutable after a lock — a correction is a new deduction and a new tabulation, never a rewritten score.
- The new run carries a name and a written reason, and the audit trail shows `tab.override`.

Paper cannot do this. A spreadsheet cannot do this, because a spreadsheet's history is whoever last hit save.

**10. Now ask the question that closes:**

> If a team's captain emails you tomorrow asking to see the math, what do you send them today?

The honest answer is that the score sheets are in a folder in someone's apartment, if they weren't recycled. Then answer it yourself. Click **Emcee sheet** (print it, or save it as a PDF), then **Feedback** next to that team — its placement, its deduction and the reason written for it, and what each judge wrote to that team, read straight from the frozen snapshot.

Note out loud what is *not* in that file: no scores, and no judge's name. Then make the distinction, because it is the whole answer:

> You can prove the placement is right. That's different from handing them the score sheet — which is just an invitation to argue about a 27 versus a 28.

The proof lives in the lock: the snapshot re-runs and returns the same placements, in front of them, a day later or a year later. The captain gets an answer instead of an argument. One file per team, too — you cannot accidentally send a team its rivals' notes, because there is no file that contains them.

**Aside, if a judge's link comes up.** Any judge can be revoked from the board screen mid-comp. The link stops opening; their scores stand and still count. Revoking is not a retraction.

## What to say when they push back

**"Paper works fine."** It does, until it doesn't. This is insurance sold before the fire. Do not argue that the forms are nicer — ask whether they have ever had a team question a placement, and watch what happens in the room. Rank the pains: money is a last-month pain, scoring is a someday pain.

**"You're a student. Will this exist next year?"** Data exports from day one — not a promise, a button: show them the feedback CSV you just downloaded. Worst case they end up back in Sheets, with better Sheets. Founding customers get the founder on-call for tab day.

**"Our league might build this."** Good — introduce me. If Origins or NDDL wants an official tabulation layer, that is the best outcome on the board, not the worst.

**"What about payments?"** Not an objection — it is the buying signal, and it is the pain. Point at [PAYMENTS.md](PAYMENTS.md), which costs nothing to show and demonstrates that the hard part — gross vs. net, unbundling a lump payment, ACH-first routing — has already been thought through. Then ask them to sign.

**"Could you also do hospitality / rooming?"** Not built, and not next. Say why, because the why *is* the close: you cannot assign rooms to teams you do not have a paid roster for. Rooming sits directly on top of registration and payments — the system already bills per room (`per_room_cents`, a `hotel` charge) and there is nothing underneath it. So: **signing is what builds the thing that makes room management possible.** Write the request down as evidence in [PIPELINE.md](PIPELINE.md); do not write it into the build.

Free sharpens this trap rather than dulling it. With no price to haggle over, "build me X and we'll use it" becomes the only thing a board has left to offer — and it is not an offer. Trade the feature for the signature, never for the roadmap.

Anything else they ask for goes the same way. A board naming a feature is a board telling you it wants to buy — route it to the ask, not to the backlog.

## The ask

**Do not end a call without this.** [PIPELINE.md](PIPELINE.md) counts a conversation only if you demoed *and* you asked; a demo with no ask scores **0**, and two of those have already happened. The thing to fix when they pile up is the asking, not the product.

The founding season is free, so the ask is not for money. **It is for the three things that prove they mean it** — and getting all three is the entire job of the call. Free makes "yes" worthless; these are what replace it.

Say it plainly, and then stop talking:

> It's **$300 a season, and I'm waiving it for your first year** — the spring comp runs free, registration and payments included. I'm doing that for three boards, and I pick them by September 15.
>
> What I need from you isn't money. It's three things: **you** — one person, not "the board" — **your comp date**, **your roster and fee schedule and last season's payment records**, so I can build against your real numbers instead of my guesses. And **a $300 line in next year's budget**, so whoever takes over from you in May inherits a line item instead of a surprise.
>
> That's it. If the reconciliation doesn't work, you've lost nothing.

Then hold the silence. If they hesitate:

- **They risk nothing.** No money, no lock-in, and the scoring is theirs regardless — the thing they just watched work is never held hostage.
- **The data is the deal.** Say why you need it out loud: *"I'd rather build this against your actual $2,160 lump than a made-up one."* It is true, it is flattering, and it is the request that separates a real board from a polite one. Then send [INTAKE.md](INTAKE.md) before you hang up, so the ask survives the call — it is written for them, not for you, and it makes the first half cheap to say yes to: send the rubric and the roster, and see your own comp on the next call.
- **The deadline is real, and it is not a sales tactic:** fewer than three founding partners and this becomes a hobby build for two comps. That is written down in the PRD, and it is why yes has to happen before September.

**Name the price even though you are waiving it.** Always "$300, free for you," never "it's free." A price that exists and is forgiven is a business; a price that does not exist is a favour, and a favour from a student reads as a class project — which is the credibility objection you actually have (PRD §12).

A board that will take it for free but will not send you a roster or write one line in a budget is the cheapest no you will ever get, and it is worth more than a maybe. Write it in the table and move on.

## Afterward

Log the call in [PIPELINE.md](PIPELINE.md) — including whether you asked. Then reseed before the next one. The demo comp is disposable on purpose.
