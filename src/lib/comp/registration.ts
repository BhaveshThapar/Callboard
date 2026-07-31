import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { violatedConstraint } from "@/db/errors";
import type { RegistrationConfig } from "@/db/schema";
import { comps, orgs, people, teams, TEAMS_BID_CODE_UNIQUE } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { nextBidCode } from "@/lib/roster/roster";
import { validateAnswers } from "./fields";

export type OpenRegistration = {
  compId: string;
  orgId: string;
  compName: string;
  orgName: string;
  compDate: string | null;
  venue: string | null;
  form: RegistrationConfig;
};

/**
 * The public form's only read, and the first of the two unauthenticated reads in the product.
 * `publicComp` in `./public.ts` is the other, and it was written against this one's rule.
 *
 * There is no `Actor` here — an applicant is nobody yet, which is the point of registration — so
 * this returns exactly the fields a stranger may see and no others. It never selects a team, a
 * score, or a person. `scope.ts` is bypassed because there is no scope to apply, not because the
 * rule is being relaxed: the projection *is* the scope, and it is this type.
 *
 * Null when there is no form (`comps.registration` unset) or the comp is not `open`. The two are one
 * answer to an applicant — there is nothing here to fill in — and distinguishing them publicly would
 * leak the existence and timing of a comp that has not opened.
 */
export const openRegistration = async (
  orgSlug: string,
  compSlug: string,
): Promise<OpenRegistration | null> => {
  const [row] = await db
    .select({
      compId: comps.id,
      orgId: orgs.id,
      compName: comps.name,
      orgName: orgs.name,
      compDate: comps.compDate,
      venue: comps.venue,
      status: comps.status,
      registration: comps.registration,
    })
    .from(comps)
    .innerJoin(orgs, eq(orgs.id, comps.orgId))
    .where(and(eq(orgs.slug, orgSlug), eq(comps.slug, compSlug)))
    .limit(1);

  if (!row || row.status !== "open" || !row.registration) return null;

  return {
    compId: row.compId,
    orgId: row.orgId,
    compName: row.compName,
    orgName: row.orgName,
    compDate: row.compDate,
    venue: row.venue,
    form: row.registration,
  };
};

export type Application = {
  teamName: string;
  school: string | null;
  contactName: string;
  contactEmail: string;
  rosterSize: number;
  auditionUrl: string | null;
  waiverAccepted: boolean;
  /** Answers to the comp's own questions, keyed by field id, exactly as they came off the form. */
  custom: Record<string, string>;
};

export type ApplicationResult =
  | { ok: true; bidCode: string }
  | { ok: false; message: string };

/**
 * How many times a bid code may be taken out from under this application before it gives up. A
 * conflict means another applicant landed in the same millisecond; the loser re-reads and takes the
 * next free code, so each retry is a fresh contest with one fewer contestant. Five is far past what
 * a student comp's registration day can produce and still terminates rather than spinning.
 */
const BID_CODE_ATTEMPTS = 5;

/**
 * Files an application. Writes a `people` row for the contact and a `teams` row at `applied`.
 *
 * `people` is unique on `(org_id, email)`, so a captain who registers two teams across two comps is
 * one person, and an upsert is the correct write rather than a duplicate. That uniqueness is also
 * what makes this idempotent-ish under a double submit on a flaky phone: the person is reused, and
 * the team gets its own row, which a board can drop.
 *
 * Deliberately **not** in a transaction. If the `teams` insert fails, an orphan `people` row is a
 * person with no team — inert, invisible, and harmless. ADR-0012's pool exists for invariants that
 * span statements, and "a contact exists" is not one; spending a WebSocket handshake on every
 * application to avoid a harmless orphan would be paying the cost in the wrong place.
 *
 * **The bid code is minted by a read-then-insert, so it races.** `nextBidCode` scans the codes in
 * use and returns the first free one; on neon-http that read and this insert are two acts, and on
 * registration day every team in the circuit applies inside the same 48 hours. Two captains hitting
 * submit in the same second both get told `T-004`, and `teams_comp_bid_code_unique` refuses the
 * second — which is correct, and is the same shape as the lock chain: the check narrows the race and
 * the database is what actually closes it.
 *
 * The *remedy* is the opposite of the lock's, though, and that is the thing worth being precise
 * about. A second root lock must never exist, so `lockAction` turns the constraint into a refusal. A
 * second application must absolutely exist — the applicant did nothing wrong and the next code is
 * always free — so here the constraint is a **retry**. Without it the loser's application simply
 * fails, on the one page in the product with no `Actor` behind it and no board member watching.
 */
export const apply = async (
  open: OpenRegistration,
  application: Application,
): Promise<ApplicationResult> => {
  if (!application.waiverAccepted) {
    return { ok: false, message: "You have to accept the waiver to apply." };
  }
  if (!application.teamName.trim()) return { ok: false, message: "Your team needs a name." };
  if (!application.contactName.trim()) return { ok: false, message: "We need a contact name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(application.contactEmail)) {
    return { ok: false, message: "That email address does not look right." };
  }
  if (!Number.isInteger(application.rosterSize) || application.rosterSize <= 0) {
    return { ok: false, message: "Roster size must be a whole number above zero." };
  }
  if (open.form.maxRosterSize && application.rosterSize > open.form.maxRosterSize) {
    return {
      ok: false,
      message: `This comp caps rosters at ${open.form.maxRosterSize} dancers.`,
    };
  }
  if (open.form.requireAuditionUrl && !application.auditionUrl?.trim()) {
    return { ok: false, message: "This comp requires an audition video link." };
  }

  // The comp's own questions are checked against the comp's own config, which is the only thing
  // that can say what was asked. The form's `required` attributes are a courtesy to an honest
  // applicant; this is the rule, and it is also the whitelist — an answer is kept only if a field
  // asked for it, so a hand-crafted POST writes nothing extra.
  const custom = validateAnswers(open.form.fields, application.custom);
  if (!custom.ok) return { ok: false, message: custom.message };

  const email = application.contactEmail.trim().toLowerCase();
  const [contact] = await db
    .insert(people)
    .values({ orgId: open.orgId, name: application.contactName.trim(), email })
    .onConflictDoUpdate({
      target: [people.orgId, people.email],
      set: { name: application.contactName.trim() },
    })
    .returning({ id: people.id });

  if (!contact) return { ok: false, message: "Could not record the contact." };

  // The `try` wraps the insert and nothing else, so the only thing this loop can retry is the one
  // statement that actually races. A failure anywhere else — including the audit write below — is not
  // a lost contest for a bid code and must not be replayed as one.
  let filed: { id: string; bidCode: string } | null = null;

  for (let attempt = 1; attempt <= BID_CODE_ATTEMPTS && !filed; attempt++) {
    const bidCode = await nextBidCode(open.compId);

    try {
      const [team] = await db
        .insert(teams)
        .values({
          compId: open.compId,
          name: application.teamName.trim(),
          school: application.school?.trim() || null,
          bidCode,
          status: "applied",
          rosterSize: application.rosterSize,
          contactPersonId: contact.id,
          auditionUrl: application.auditionUrl?.trim() || null,
          waiverAcceptedAt: new Date(),
          customAnswers: custom.answers,
        })
        .returning({ id: teams.id });

      if (!team) return { ok: false, message: "Could not file the application." };
      filed = { id: team.id, bidCode };
    } catch (error) {
      if (violatedConstraint(error) !== TEAMS_BID_CODE_UNIQUE) throw error;
    }
  }

  if (!filed) {
    return {
      ok: false,
      message: "Registration is busy right now. Give it a moment and submit again.",
    };
  }

  // `system`, not `board` or `judge`: an applicant is not an actor in this comp and has no person
  // row the audit log is scoped to trust. The contact is recorded in `after`, where it is evidence
  // rather than attribution.
  await recordAudit({
    compId: open.compId,
    actorKind: "system",
    action: "team.apply",
    entity: "team",
    entityId: filed.id,
    after: {
      bidCode: filed.bidCode,
      teamName: application.teamName.trim(),
      contactEmail: email,
    },
  });

  return { ok: true, bidCode: filed.bidCode };
};
