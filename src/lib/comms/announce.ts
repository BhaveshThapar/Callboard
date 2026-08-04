/**
 * The board's own voice — the first **broadcast** template, and the reason `people.unsubscribed_at`
 * exists at all.
 *
 * Everything else the engine sends is transactional: a bill, a receipt, a credential. Those are owed
 * to somebody whether or not they want them. An announcement is a board choosing to speak, which is
 * the category a person is entitled to opt out of — the split is enforced in `sweep`, which bounces a
 * broadcast to an unsubscribed recipient and sends a transactional one.
 *
 * Pure, like the other planners. The caller enqueues.
 */
import { createHash } from "node:crypto";
import { ANNOUNCEABLE_STATUSES } from "@/db/schema/teams";
import type { RosterTeamView } from "@/lib/auth/scope";
import { contactPersonFor } from "./contact";
import type { MessagePayloads } from "./render";

const ANNOUNCEABLE: readonly string[] = ANNOUNCEABLE_STATUSES;

export type AnnouncementRecipient = {
  teamId: string;
  teamName: string;
  personId: string;
  dedupeKey: string;
  payload: MessagePayloads["announcement.sent"];
};

export type AnnouncementSkip = { teamId: string; teamName: string; reason: "no-contact" };

export type AnnouncementPlan = {
  send: AnnouncementRecipient[];
  skipped: AnnouncementSkip[];
};

/**
 * Keyed on the **text**, so the same announcement cannot reach one team twice.
 *
 * This is a different bargain from the dues key and worth seeing as one. There, the period is a
 * policy someone chose. Here the key says *this exact message, to this team, once* — which refuses a
 * double-clicked send and also refuses a board deliberately re-sending identical words later. That
 * second case is real but rare, and it is answered by changing a word; the alternative is a key that
 * cannot tell a fat-fingered second click from a decision, and one of those mistakes reaches
 * everybody at once.
 */
export const announcementDedupeKey = (teamId: string, subject: string, body: string): string =>
  `announce:${teamId}:${createHash("sha256").update(`${subject}\n${body}`).digest("hex").slice(0, 16)}`;

/**
 * Who hears it.
 *
 * `ANNOUNCEABLE_STATUSES` rather than the roster: a team that dropped does not get told where to
 * park, and a team still on the waitlist has not been told it is coming. A team with nobody to write
 * to is reported rather than dropped, for `BillingGap`'s reason — "we told everybody" and "we told
 * six of eight" are different facts and only one of them is ever true.
 */
export const planAnnouncement = (
  roster: readonly RosterTeamView[],
  captains: ReadonlyMap<string, string>,
  content: { compName: string; boardName: string; subject: string; body: string },
): AnnouncementPlan => {
  const send: AnnouncementRecipient[] = [];
  const skipped: AnnouncementSkip[] = [];

  for (const team of roster) {
    if (!ANNOUNCEABLE.includes(team.status)) continue;

    const personId = contactPersonFor(team, captains);
    if (!personId) {
      skipped.push({ teamId: team.id, teamName: team.name, reason: "no-contact" });
      continue;
    }

    send.push({
      teamId: team.id,
      teamName: team.name,
      personId,
      dedupeKey: announcementDedupeKey(team.id, content.subject, content.body),
      payload: {
        compName: content.compName,
        subject: content.subject,
        body: content.body,
        boardName: content.boardName,
      },
    });
  }

  return { send, skipped };
};
