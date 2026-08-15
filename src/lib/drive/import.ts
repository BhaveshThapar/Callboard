import { eq } from "drizzle-orm";
import { db } from "@/db";
import { violatedConstraint } from "@/db/errors";
import { people, teams, TEAMS_BID_CODE_UNIQUE } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import { orgOfComp } from "@/lib/auth/accounts";
import type { BoardActor } from "@/lib/auth/scope";
import { nextBidCode } from "@/lib/roster/roster";
import { accessTokenFor } from "./connections";
import { folderIdFrom, listImportable, readCsv, type DriveFile } from "./google";
import { isImportable, parseRoster, type TeamCandidate } from "./parse";

/** Same ceiling `apply` uses: registration day is the whole circuit racing for the same code. */
const BID_CODE_ATTEMPTS = 5;

export type ImportPreview = {
  file: DriveFile;
  mapping: Record<string, string>;
  unmappedHeaders: string[];
  candidates: TeamCandidate[];
  /** Teams already on this comp, matched by name, so a re-run does not double a roster. */
  alreadyPresent: string[];
};

export type PreviewResult = { ok: true; value: ImportPreview } | { ok: false; message: string };

export const listFolder = async (
  actor: BoardActor,
  folderInput: string,
): Promise<{ ok: true; files: DriveFile[] } | { ok: false; message: string }> => {
  const orgId = await orgOfComp(actor.compId);
  if (!orgId) return { ok: false, message: "That comp is not in an org." };

  const folderId = folderIdFrom(folderInput);
  if (!folderId) return { ok: false, message: "That does not look like a Drive folder link." };

  const token = await accessTokenFor(orgId);
  if (!token.ok) return { ok: false, message: token.message };

  const files = await listImportable(token.accessToken, folderId);
  if (!files.ok) return { ok: false, message: files.reason };
  if (files.value.length === 0) {
    return { ok: false, message: "No sheets or CSVs in that folder." };
  }
  return { ok: true, files: files.value };
};

/**
 * Reads a file and says what importing it would do. **Writes nothing.**
 *
 * This product never puts a roster in the record without a person deciding, and an importer that
 * inserted on contact is how a board loses one. So the flow is read → preview → confirm, and the
 * preview carries every row the sheet had, including the ones that cannot be imported and why.
 *
 * `alreadyPresent` is matched on name because that is the only thing a board's spreadsheet and this
 * comp reliably share — there is no external id, and bid codes are minted here rather than in the
 * sheet. It is shown rather than acted on: whether a same-named row is the same team is a board's
 * question, and re-importing a season is exactly when it stops being obvious.
 */
export const previewImport = async (
  actor: BoardActor,
  file: DriveFile,
): Promise<PreviewResult> => {
  const orgId = await orgOfComp(actor.compId);
  if (!orgId) return { ok: false, message: "That comp is not in an org." };

  const token = await accessTokenFor(orgId);
  if (!token.ok) return { ok: false, message: token.message };

  const csv = await readCsv(token.accessToken, file);
  if (!csv.ok) return { ok: false, message: csv.reason };

  const parsed = parseRoster(csv.value);
  if (parsed.candidates.length === 0) {
    return { ok: false, message: "That sheet has no rows under its header." };
  }
  if (!parsed.mapping.name) {
    return {
      ok: false,
      message: "No column in that sheet looks like a team name. Rename it to 'Team' and try again.",
    };
  }

  const existing = await db
    .select({ name: teams.name })
    .from(teams)
    .where(eq(teams.compId, actor.compId));

  const present = new Set(existing.map((t) => t.name.trim().toLowerCase()));

  return {
    ok: true,
    value: {
      file,
      mapping: parsed.mapping as Record<string, string>,
      unmappedHeaders: parsed.unmappedHeaders,
      candidates: parsed.candidates,
      alreadyPresent: parsed.candidates
        .filter((c) => present.has(c.name.trim().toLowerCase()))
        .map((c) => c.name),
    },
  };
};

export type ImportOutcome = { imported: number; skipped: number };

/**
 * Writes the rows a board confirmed.
 *
 * **Every team lands `applied`, and that is load-bearing rather than a default.** `applied` is not
 * in `BILLABLE_STATUSES`, so importing a roster creates *no obligation* — accepting each team does,
 * through `setTeamStatus`, which is the transaction that already generates what a team owes. If the
 * importer inserted `accepted` teams it would become a second path that creates money, and there
 * would be two places in this product that decide what a team is charged.
 *
 * **Not a `withTransaction` caller.** A partial import leaves some teams applied and the rest not
 * imported, which is a state a board can see on the roster and finish by re-running — the second run
 * shows the first run's teams under `alreadyPresent`. Nothing is owed and nothing is half-owed, so
 * there is no invariant spanning statements; ADR-0012 asks for that to be argued rather than assumed.
 *
 * The bid-code retry is `apply`'s, for `apply`'s reason: `nextBidCode` is a read-then-insert, and a
 * board importing while a captain registers is exactly the race it was written for.
 */
export const importTeams = async (
  actor: BoardActor,
  candidates: readonly TeamCandidate[],
): Promise<{ ok: true; value: ImportOutcome } | { ok: false; message: string }> => {
  const orgId = await orgOfComp(actor.compId);
  if (!orgId) return { ok: false, message: "That comp is not in an org." };

  let imported = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    if (!isImportable(candidate)) {
      skipped += 1;
      continue;
    }

    let contactId: string | null = null;
    if (candidate.contactEmail) {
      const stated = candidate.contactName?.trim() || null;

      const [contact] = await db
        .insert(people)
        .values({
          orgId,
          // A row has to have a name and the sheet did not give one, so the address stands in for a
          // person nobody has named yet. That is only ever written on **insert**.
          name: stated ?? candidate.contactEmail,
          email: candidate.contactEmail,
        })
        // `people` is org-scoped and survives a comp delete, so this must find rather than insert a
        // second row -- `people_org_email_unique` is what would otherwise refuse it (ADR-0013).
        //
        // **The name is only overwritten when the sheet actually stated one.** A sheet with an email
        // column and no captain column would otherwise rename every person it matched to their own
        // address -- and `people` is the row an account, a board membership and every message
        // recipient hang off, with no history to undo it. Registration cannot do this because it
        // refuses a blank contact name; the fallback is this importer's, so the guard is too. When
        // there is no name to write, the conflict clause updates the email to itself, which is a
        // no-op that still lets `.returning()` hand back the id.
        .onConflictDoUpdate({
          target: [people.orgId, people.email],
          set: stated ? { name: stated } : { email: candidate.contactEmail },
        })
        .returning({ id: people.id });
      contactId = contact?.id ?? null;
    }

    let filed: { id: string; bidCode: string } | null = null;
    for (let attempt = 1; attempt <= BID_CODE_ATTEMPTS && !filed; attempt += 1) {
      const bidCode = await nextBidCode(actor.compId);
      try {
        const [team] = await db
          .insert(teams)
          .values({
            compId: actor.compId,
            name: candidate.name.trim(),
            school: candidate.school,
            bidCode,
            status: "applied",
            rosterSize: candidate.rosterSize,
            rooms: candidate.rooms,
            contactPersonId: contactId,
          })
          .returning({ id: teams.id });
        if (team) filed = { id: team.id, bidCode };
      } catch (error) {
        if (violatedConstraint(error) !== TEAMS_BID_CODE_UNIQUE) throw error;
      }
    }

    if (!filed) {
      skipped += 1;
      continue;
    }

    imported += 1;
    await recordAudit({
      compId: actor.compId,
      actorKind: "board",
      actorPersonId: actor.personId,
      action: "team.imported",
      entity: "team",
      entityId: filed.id,
      after: {
        bidCode: filed.bidCode,
        teamName: candidate.name.trim(),
        sourceRow: candidate.row,
      },
    });
  }

  return { ok: true, value: { imported, skipped } };
};
