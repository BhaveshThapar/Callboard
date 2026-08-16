# Runbook — deploying, and walking what you deployed

[`DEMO.md`](DEMO.md) is the sales instrument and its preflight is **database-shaped**: it verifies
invariants and says nothing about whether the host serves a 200 or whether a message ever left the
building. This is the host-shaped half, and it exists because six rows on
[`FEATURE_MAP.md`](FEATURE_MAP.md) are merged, tested, migrated and have never been run against the
deployed database — so `Live` is a word this repo has had to define four separate times.

**Merging is not deploying, and deploying is not migrating.** Vercel ships code on a merge to `main`.
Nothing applies a migration but a person.

---

## Part 1 — After any merge

```bash
# 1. Migrations, if the merge added a file to drizzle/
DATABASE_URL='<neon main pooled>' bun run db:migrate

# 2. The database preflight. Read the SECOND line, every time.
DATABASE_URL='<neon main pooled>' bun run db:doctor

# 3. What the deployment itself is configured to do — a different machine from step 2's
DATABASE_URL='<neon main pooled>' bun run db:doctor --host https://<your-app>.vercel.app

# 4. Does it actually serve?
curl -sf https://<your-app>.vercel.app/api/health && echo OK
```

Step 2 without `· the deployed demo` on its second line means you checked a different database.
Step 3 is not optional if you have changed any environment variable: steps 2 and 3 have **different
subjects**, and the config block says which it read.

`.github/workflows/migrations.yml` now does step 1's check for you on every push to `main` that
touches `drizzle/`, and again daily. A red run there is a to-do, not a fault.

---

## Part 2 — Credentials, and the order

**Set `RESEND_API_KEY` and `COMMS_FROM` before `CRON_SECRET`.** This is not stylistic.

`recordingTransport.send` returns `{ ok: true }`, so a sweep against a host that cannot send takes
the *success* branch: every claimed message lands `state = 'sent'` with a null `provider_ref`, and
`scrubPayload` destroys the raw invitation link ([ADR-0021](decisions/0021-the-outbox-holds-a-secret-only-until-it-sends.md)).
`messages_comp_dedupe_unique` then refuses a re-enqueue, and `enqueue` returns `duplicate` — which by
design is not an error and shows a board *already sent*. **Permanently marked sent, credential
destroyed, unsendable, having reached nobody.** There is no `revoked_at` on somebody's inbox.

Production's `messages` table is empty as of August 15, 2026, so nothing is at risk until somebody
clicks a comms button on the deployed host. `db:doctor` refuses to exit 0 on this combination.

| Secret | Created where | Set where | Unblocks |
|---|---|---|---|
| `NEXT_PUBLIC_BASE_URL` | — | Vercel | opt-out line, `List-Unsubscribe`, invite links, Drive callback |
| `RESEND_API_KEY` | Resend dashboard | Vercel | C2, A10, ADJ·2, A7 receipts |
| `COMMS_FROM` | Resend — **a verified domain you own** | Vercel | same |
| `CRON_SECRET` | `openssl rand -base64 32` | Vercel **and** GitHub secrets — must match | the sweep |
| `PRODUCTION_URL` | — | GitHub **variables** *and* GitHub **secrets** — see below | the migration guard, and the sweep |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Google Cloud Console | Vercel | A11 |
| `DRIVE_TOKEN_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | Vercel | A11 |

`NEXT_PUBLIC_BASE_URL` being unset deserves its own line: `announce.ts` sets `unsubscribeUrl: null`
when it cannot form one, and the visible opt-out line and the `List-Unsubscribe` header come off that
**one** field so they cannot disagree. A host that can send and cannot form the URL broadcasts with
**no opt-out at all** — not header-only, none.

**`PRODUCTION_URL` has to be set twice today, and that is a wart with a date on it.**
`migrations.yml` reads it as a repository *variable*, because a public URL is not a credential and a
variable's absence is diagnosable in the settings UI rather than guessed at. `comms.yml` still reads
it as a *secret*, and moving it belongs with that workflow's own fix rather than here — so set the
same value in both until they are reconciled. Nothing breaks if you set only one; the workflow that
reads the other fails loudly, which is the intended behaviour of both.

Google Cloud also needs, outside any environment variable: the Drive API enabled, `drive.readonly`
on the consent screen, and `${NEXT_PUBLIC_BASE_URL}/api/drive/callback` registered as a redirect URI.

After setting anything, re-run `db:doctor --host` and read the config block.

---

## Part 3 — The walk

A row moves to `Live` when somebody has **observed** the thing below, on the deployed host. A passing
test is not one of these; that is the whole distinction the status word carries.

| Row | What the walk must observe |
|---|---|
| **P4** | Sign in with a real account. Land on `/app`. The nav shows five tabs as a board member, one as a captain. Sign out, and confirm **both** credentials are gone — the session *and* the board-link cookie. |
| **A4** | A captain files final music, an emergency contact and a roster claim. The board reads all three on the roster screen. **The team's balance has not moved** — a claim is not a bill until `setTeamBilling` states it. |
| **C2** | A message arrives in a **real** inbox. The opt-out link in the body is **clickable** and lands on `/unsubscribe/…`. Not the header — the visible line. |
| **A10** | A dues reminder arrives carrying that team's own charge lines, correct to the cent. Click the button a second time: the screen says *already sent this month* rather than showing red. |
| **ADJ·2** | A placed team receives its placement, its deduction and reason, and each judge's note under `Judge N` — and **no score anywhere in the message**. |
| **A11** | A real Google handshake completes. The preview matches the sheet row for row, including the rows that cannot be imported and why. Confirming imports them at `applied`, and **no charge is created**. |

Then move the rows on `FEATURE_MAP.md` — **as an act performed against production, in its own
commit**, never in the same commit as a feature. That half was never about the vocabulary.

---

## Part 4 — When something is wrong

| Symptom | Almost certainly |
|---|---|
| Every page 500s after a merge | The migration was not applied. `db:doctor` names how far behind. |
| `db:doctor` says healthy but a board reports a dead link | You checked the wrong database — read the second line. |
| A board clicked send and nobody received anything | Sending is not configured. `db:doctor --host` says so; the screens now carry the caveat too. |
| Messages stuck in `sending` | **Do not retry.** That is the crash-after-send footprint, and retrying emails somebody twice. `db:doctor` reports them by id; check whether they arrived. |
| The comms workflow is green and nothing sends | It was green for doing nothing until Aug 2026. It fails on unset secrets now. Check `PRODUCTION_URL` and `CRON_SECRET`. |
| `migrations.yml` red right after a merge | Expected. Apply the migration, then re-run it from the Actions tab. |
