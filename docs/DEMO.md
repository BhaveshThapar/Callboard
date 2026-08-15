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

**Read the second line of the output, every time.** It names the compute the verdict is about:

```
✓ Demo healthy: board "Ananya Krishnan", 3 judges, 9 teams.
  ep-round-fire-a6dyy8t8-pooler · the deployed demo

Configuration (this shell, not the deployment):
  ⚠ nothing sent from this host leaves the building: RESEND_API_KEY and COMMS_FROM are unset…
  ⚠ the outbox is never swept: CRON_SECRET is unset…

  Note: the verdict above is about this shell. db:doctor cannot see Vercel's environment.
  Re-run with --host https://<the deployment> to ask the deployment itself.
```

Without `· the deployed demo`, you checked a different database and the deployed one is still whatever it was. That is not hypothetical: **the demo returned 500s from July 13 to August 1, 2026** — nineteen days, across three waves of merged work — because Neon `main` sat at migration `0006` while Vercel served code expecting `0010`. The preflight existed the whole time and was run against `dev`, which was current. Both runs printed the same green line.

The doctor now also refuses a database behind the repo, by counting `drizzle.__drizzle_migrations` against `drizzle/meta/_journal.json`. That check exists because the two older ones are constraint-shaped and migrations `0007` and `0008` add no constraint at all — nothing could see them missing, and `0007` is the one that broke the demo.

**Two subjects, and they are different machines.** The database half is about whatever `DATABASE_URL` names. The configuration half is about *this shell* — so running the documented command above puts production's database in front of your laptop's `RESEND_API_KEY`, and the config block says so rather than pretending otherwise. To ask the deployment what it is actually configured to do:

```bash
DATABASE_URL='<neon main pooled>' bun run db:doctor --host https://<your-app>.vercel.app
```

That reads `/api/health` on the deployment, and the block is then labelled with the URL instead of *this shell*.

**A caveat is not a failure.** An absence — no `RESEND_API_KEY`, no `CRON_SECRET` — is reported and exits 0, because that is production's deliberate state today and a preflight that went red for it is one you would learn to skip. A **hazard** exits 1: a half-configured pair, a `DRIVE_TOKEN_KEY` that is set and the wrong length, or `CRON_SECRET` set while sending is off. That last one is the destructive combination — the sweep marks everything queued as sent through a transport that sends nothing, scrubs the invitation links, and the dedupe index then refuses to queue any of it again. **If you ever switch comms on, the order is `RESEND_API_KEY` + `COMMS_FROM`, then `NEXT_PUBLIC_BASE_URL`, then `CRON_SECRET` last.**

**Merging is not deploying.** Vercel ships the code on a merge to `main`; nothing applies the migration. After merging anything with a new file in `drizzle/`, run `DATABASE_URL='<neon main pooled>' bun run db:migrate` and then this preflight. [`RUNBOOK.md`](RUNBOOK.md) is the host-shaped checklist this page's preflight is the database-shaped half of.

CI now says so on its own, so this no longer depends on remembering: `.github/workflows/migrations.yml` runs on every push to `main` that touches `drizzle/`, and again daily, comparing what production reports having applied against `drizzle/meta/_journal.json`. It asks over HTTP rather than connecting to production's database, so there is **no database credential in CI** — it needs one repository *variable*, `PRODUCTION_URL`. The post-merge run is expected to be red until you migrate; re-run it from the Actions tab once you have.

## Before the call

```bash
DATABASE_URL='<neon main pooled>' \
NEXT_PUBLIC_BASE_URL='https://<your-app>.vercel.app' \
  bun run db:seed
```

A leading environment variable wins over `.env.local`, so nothing needs editing. This wipes and reseeds the demo comp — Mayuri 2027, eight competing teams **and one applicant**, three judges, a four-criterion fusion rubric normalized by z-score with a head-to-head tiebreak — and prints five links:

```
Board (open on a laptop):
  Ananya Krishnan  https://.../board/<token>

Judges (one per phone):
  Priya Raghavan   https://.../judge/<token>
  Arjun Mehta      https://.../judge/<token>
  Sonia Desai      https://.../judge/<token>

Board account (accept once, then sign in):
  Ananya Krishnan  https://.../invite/<token>
                   signs in as ananya@example.com
```

The raw tokens are shown exactly once. Only their sha256 is stored. Text the judge links; open the board link on the laptop you are screen-sharing.

**The board link no longer stays in the address bar.** Opening it exchanges the token for an
`HttpOnly` cookie and lands you at `/app/maryland-mayuri/mayuri-2027` — the product, with a header, a
role badge and a nav across Overview · Roster · Money · Results · People
([ADR-0022](decisions/0022-a-link-is-exchanged-for-a-cookie.md)). Worth one sentence on the call if
somebody is watching the URL bar: the credential stopped being screen-shared along with everything
else, which is ADR-0003's own named hardening finally taken.

**The fifth link is the same product reached the other way**, and it is worth showing to a board that
asks *"do we all have to share one link?"* — accept it once, set a password, and Ananya signs in at
`/sign-in` to exactly the screens the link opens. Both work; neither invalidates the other. A judge
still has no account and never will.

**The comp seeds with registration `open` and a live public form**, which is what the money beat's
closing step and ADJ·3's page both need. Two payments are seeded as background — UMD Moksha settled
in full, Pitt Nrityamala's hotel still outstanding — so the money screen opens on real numbers
rather than nine zeroes. **Neither is a step below.** PRD §14's two exhibits, BU Dheem's $97.01 and
the $2,160 lump, are deliberately *not* seeded, because the beat types them in front of the
prospect: a row the script asks for that already exists does not merely look redundant, it is
refused by the allocation ceiling, mid-call.

The seed proves each of these links resolves against the live schema before printing them, so a clean `db:seed` is itself the health check — a seed that cannot mint a working board *or* judge link fails loudly instead of handing you a dead one. If you forget the `NEXT_PUBLIC_BASE_URL` above, the links fall back to `localhost` and the seed prints a `⚠` saying so — localhost links open on your laptop and 404 on a phone. Run `db:doctor` any time afterward to re-confirm without reseeding.

The board link carries a name because it belongs to a person, not to the comp. That is what lets a lock and a correction be attributed to a human (PRD B6, [ADR-0007](decisions/0007-board-links-are-per-person.md)). Add board members in `comp-config.json` and each gets their own link.

Reseeding at any point gives you fresh links and a clean comp.

## Running it with their rubric

If a board asks *"can we try it with ours?"* — say yes on the call, and do it afterward. **Do not treat this as a favour: it is the ask.** Send them [INTAKE.md](INTAKE.md), which is written to be forwarded to a treasurer, and what comes back is Part 1 of the three things a founding partner owes you. Copy `comp-config.example.json`, fill in their criteria, weights, normalization, tiebreakers, teams, bid codes, and judges, then:

```bash
DATABASE_URL='<neon main pooled>' bunx tsx src/db/seed-cli.ts --config their-comp.json
```

It seeds its own org and cascades independently, so it cannot disturb the Mayuri demo. All three normalizations (`raw`, `zscore`, `rank`) and all three tiebreakers (`criterion`, `head_to_head`, `highest_single_judge`) are supported.

**If they run divisions, give each one its own `comp.slug` under the same `org.slug`.** A comp is one division ([ADR-0010](decisions/0010-a-comp-is-one-division.md)), so two divisions are two comps — two configs, two seeds, a board screen and a judge panel each. Seeding the second does not disturb the first, and the same tab chair can sit on both and get a link per comp ([ADR-0013](decisions/0013-a-seed-replaces-a-comp-not-an-org.md)). What you must not do is reuse the same `comp.slug`, which is a reseed of that comp rather than a second division.

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

## The money beat — first, and only if discovery found a gap

**Run this before the scoring beat, not after it**, and the reason is a property of the product
rather than a preference about selling: **the roster freezes at the lock.** `teams` lives inside
`tab_runs.inputs`, so once placements are locked nothing on the roster can move — no acceptance, no
room count, no status change. A money beat placed after the lock has no moves left in it. That is
not hypothetical: this section sat at step 11, after the lock at step 5, and opened with *"accept a
team"* on a roster where every team was already competing. **It could not be run at all**, and
nobody found out until it was rehearsed end to end against the deployed host.

Order it this way and it also matches what just happened in the room. You asked about money first,
they described their version of the $5k gap, and this answers it while it is still in the air.
Scoring is the credential; this is the pain.

Follow **Who owes what** from the board screen.

The demo seeds **RU Natya** as `applied` — Mayuri 2026 had 38 teams apply for 8 slots, so an
applicant is the normal state of that roster, and it is the team this whole beat runs on.

**1. Money arrives before obligations do.** **A team sent one $2,160 Venmo labelled "hotel,
security deposit & reg fees"** — this is the real Mayuri 2026 lump, and the hand-unbundling of it is
PRD §14's headline exhibit. Record it against RU Natya, which has not been accepted yet and
therefore owes nothing. It holds as **unattached credit** rather than being refused. Say why: a team
pays a deposit to hold a slot, and a system that can only accept money against an existing bill
cannot record the payment that actually happened.

**2. Accept the team.** It now owes what the schedule says — per dancer, per room, deposit —
generated in the same act that accepted it. There is no separate step where somebody remembers to
bill.

**3. Point at the line it would not bill.** RU Natya has no room count, so the hotel line reads
**"not billed — room count unknown"** rather than $0.00. Say why out loud: a $0 hotel charge is a
lie a treasurer believes in December and finds in April. Then fill the room count in on the roster
screen — the two boxes beside the team — and watch $560 appear. The bill follows the fact, in the
same act, and the team's total lands at **$1,780**.

**4. Now unbundle the lump.** Split it across all three charges from the unattributed panel. Note
out loud that **the balance did not move** when you attached it: the money was always counted, and
what changed is that you can now say what it was for. $2,160 against $1,780 leaves **$380 still
unattached**, stated on the screen rather than lost — which is what a $5,000 gap is made of.

**5. Record the one that arrives short.** **BU Dheem's $100 deposit landed as $97.01**: type the
gross and the fee the bank shows, and the team is credited the full $100 while the processor's cut
is recorded as the org's cost rather than a hole. Leave **"email a receipt"** ticked and say what it
does: the captain is told what arrived, what it cost and what is left, and the receipt carries the
gross — the team is credited what it sent, not what survived the processor. Then say why the box is
a box: backfilling last season must not mail thirty captains who were expecting nothing.

**6. Tick a row off against the bank.** Under **What arrived**, mark a payment matched. That is the
column a treasurer works down beside a statement, and the reason the second pass through a season
does not start from nothing.

**7. Download both CSVs and put them beside the totals on screen.** *Who owes* is one row per team
and matches the screen, because the total is arithmetic over exactly the rows above it. *Payments*
is one row per transaction — the bank's own shape — with gross, fee, net and the reconciliation
mark.

Then the closing question for this half:

> When a team says it already paid, how long does it take you to find out whether that's true?

**8. Chase what is outstanding.** One button, and every team with a balance gets an email carrying
its own charge lines — signed by the treasurer, not by Callboard. Two things to say out loud while
it runs. First, **click it twice**: the second click reports *already sent this month* rather than
sending again, and the reason is a unique index rather than a disabled button — a captain being
billed twice is the exact failure this whole product is sold against. Second, **read the line about
who was not reached**: a team that owes money with no captain on file is named on screen rather than
quietly skipped, because "we reminded six of eight" and "everybody was reminded" are different facts.

Then: *how long does chasing eight teams take you today?*

**9. Say something to everybody at once.** On the roster screen, **Announce** — a subject and a
sentence, sent to every team that is `accepted` or `competing` and to nobody else. Say the exclusion
out loud, because it is the whole difference between this and a GroupMe: the waitlist has not been
told it is coming, and the team that dropped does not get told where to park. Two more things while
it sends. **Click it twice**: identical words to the same team are refused, so a double-click is not
a second email — and changing one word makes it a new announcement, which is how a board corrects
itself. And **it is signed by them, with a way out**: every announcement carries an unsubscribe link
that stops announcements and *not* receipts or anything about money owed. A board that has ever been
told to stop emailing somebody knows why that distinction has to be in the product rather than in
somebody's memory.

**Nothing is sent from the demo deployment unless it is configured to send** — `RESEND_API_KEY` and
`COMMS_FROM` are both required, and without them the engine records instead of sending. That covers
every button in this section: the reminders, the receipt, the announcement and the invitation. The
demo roster's captains are all `@example.com`, which RFC 2606 reserves and no mail can ever reach, so
a rehearsal cannot email a real person even by accident.

**Say what is not built, because they will find out anyway.** No card processing and no Stripe:
every row here is entered by hand on a rail the system records and never moves. That is deliberate —
the reconciliation gap is closed by the ledger, and routing would buy automatic ingestion, not
correctness. Everything here is also **only ever sent by a board pressing a button**: nothing decides
on its own to email somebody, and saying so is worth more than it sounds to a treasurer who has been
burned by software that mails their teams unprompted. If they want card rails, that is a thing to
hear from a founding partner rather than a thing to guess at, which makes it an ask, not an apology.

## The captain's beat — when they ask "does the team see any of this?"

Short, and only if it comes up. It usually does, right after the money beat: a treasurer who has just
watched a $2,160 lump get unbundled asks whether the team can see its own balance without being
texted a screenshot.

Run it from **People** on the board screen.

**1. Invite a captain.** Name, email, the team. The invitation sends itself — and **the screen hands
back the link anyway**, which is the part worth saying out loud. Only its sha256 is stored, the same
treatment a judge link gets, so nothing in the product can recover it once the tab is closed; and
sending is opt-in on two environment variables. A screen that said "emailed" on a deployment without
them would be telling a board to close the tab holding the only copy of a credential nobody
received. So the link is shown, and the sentence beside it says whether an email is actually going —
on this demo it says *sending is not configured*, and that is the honest version of the same screen.

**2. Open it and set a password.** The invitation **names who it is for before it is accepted**, so
the address is fixed and readonly — accepting somebody else's link cannot make you them.

**3. Land on their own team.** They see what their team owes, charge by charge, and *no other team* —
no roster, no scores, and no bid code but their own. Say why that last one matters: a competitor
holding the name-to-code mapping is the end of blind judging for that comp, arriving from inside the
product instead of from the street.

**Point at the nav while you are there.** It has one item. This is the same shell the board is
looking at, and the difference is not a hidden menu or a disabled button — the captain's actor cannot
resolve another team, so there is nothing to offer. A board that has ever worried about a shared
spreadsheet's "just don't look at that tab" understands that distinction immediately.

**4. Take them back off.** Hit **Remove** on the People screen. The next request they make is
refused. Worth saying: the *membership* is what died, not their login — the same person keeps
working at any other comp they belong to, because authority here is per comp and identity is per org.

The one sentence to close on: **a board can now reach one specific human**, which is what everything
else has been waiting on — dues reminders and receipts are built on top of it, and the schedule
pushes the Gita needs are the same engine with a different trigger.

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

**Then press *Send feedback*, and say what you just skipped.** Every placed team gets its own
placement, its own deduction and reason, and what each judge wrote — in one click, instead of eight
downloads and eight attachments. That attaching-by-hand is where a team ends up sent somebody else's
notes; it is not a hypothetical, it is what the manual version *is*. Two things worth naming while
it runs. It **refuses before the lock**, because the placement comes from the frozen snapshot — what
a team is told is what the placements were announced from. And a **correction is deliverable**: an
override supersedes the run, so re-sending after a re-lock reaches everybody with the corrected
placement, while pressing send twice against the same run reaches nobody twice. If it were keyed on
the team alone, the one time a board most needs to send again is the one time it could not.

**Aside, if a judge's link comes up.** Any judge can be revoked from the board screen mid-comp. The link stops opening; their scores stand and still count. Revoking is not a retraction.

**11. Close the registration window, if they asked how a season starts.** On the roster screen, the
window says `open` and carries the public form's address. Closing it is one click and the form stops
accepting applications — including for a captain who already had the page open, because the action
re-resolves the comp rather than trusting the render. It runs forward only: nothing reopens a comp
whose roster is being scored.

## What to say when they push back

**"Paper works fine."** It does, until it doesn't. This is insurance sold before the fire. Do not argue that the forms are nicer — ask whether they have ever had a team question a placement, and watch what happens in the room. Rank the pains: money is a last-month pain, scoring is a someday pain.

**"You're a student. Will this exist next year?"** Data exports from day one — not a promise, a button: show them the feedback CSV you just downloaded. Worst case they end up back in Sheets, with better Sheets. Founding customers get the founder on-call for tab day.

**"Our league might build this."** Good — introduce me. If Origins or NDDL wants an official tabulation layer, that is the best outcome on the board, not the worst.

**"What about payments?"** Not an objection — it is the buying signal, and it is the pain. **Show it rather than describing it**: run the money beat above, before the lock. Obligations generated by an acceptance, a hotel line withheld with a stated reason and then filled in, a $97.01 deposit recorded as $100 credited plus a fee, a $2,160 lump split across three charges, a CSV that matches the screen. [PAYMENTS.md](PAYMENTS.md) is still the thing to send afterward for the part that is *not* built — ACH-first routing and what card rails would cost them. Then ask them to sign.

**"Could you also do hospitality / rooming?"** Not built, and not next. Say why, because the why *is* the close: you cannot assign rooms to teams you do not have a paid roster for. Rooming sits directly on top of registration and payments — the system already records a room count and bills per room (`per_room_cents`, a `hotel` charge), and there is nothing above it. So: **signing is what builds the thing that makes room management possible.** Write the request down as evidence in [PIPELINE.md](PIPELINE.md); do not write it into the build.

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
