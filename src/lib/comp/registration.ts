import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import type { RegistrationConfig } from "@/db/schema";
import { comps, orgs, people, teams } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { nextBidCode } from "@/lib/roster/roster";

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
 * The public form's only read, and the only unauthenticated read in the product.
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
};

export type ApplicationResult =
  | { ok: true; bidCode: string }
  | { ok: false; message: string };

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

  const bidCode = await nextBidCode(open.compId);

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
    })
    .returning({ id: teams.id });

  if (!team) return { ok: false, message: "Could not file the application." };

  // `system`, not `board` or `judge`: an applicant is not an actor in this comp and has no person
  // row the audit log is scoped to trust. The contact is recorded in `after`, where it is evidence
  // rather than attribution.
  await recordAudit({
    compId: open.compId,
    actorKind: "system",
    action: "team.apply",
    entity: "team",
    entityId: team.id,
    after: { bidCode, teamName: application.teamName.trim(), contactEmail: email },
  });

  return { ok: true, bidCode };
};
