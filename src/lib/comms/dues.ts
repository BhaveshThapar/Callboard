/**
 * A10 — who gets chased, and for how much.
 *
 * Pure, and deliberately so: what a reminder *says* has to be a function of the roster and the
 * schedule, the same property `src/lib/fees/` is fenced for. A reminder is a bill with a stamp on
 * it, and a bill that reads differently on Tuesday is the thing this product is sold against. The
 * period is therefore passed in rather than derived from a clock here.
 *
 * It plans and does not send. The caller enqueues, so the decision of *who* is testable without a
 * database and the act of *sending* stays in one place that can be audited.
 */
import type { RosterTeamView } from "@/lib/auth/scope";
import { formatCents } from "@/lib/money/format";
import type { WhoOwes } from "@/lib/money/who-owes";
import type { MessagePayloads } from "./render";

export type DuesRecipient = {
  teamId: string;
  teamName: string;
  personId: string;
  balanceCents: number;
  dedupeKey: string;
  payload: MessagePayloads["dues.reminder"];
};

/**
 * A team that owes money and cannot be chased. Stated rather than dropped, for `BillingGap`'s
 * reason: "we did not remind four teams" and "there was nobody to remind" are different facts, and
 * a screen that silently sends three of seven has told the board something false about the other
 * four.
 */
export type DuesSkip = { teamId: string; teamName: string; reason: "no-contact" };

export type DuesPlan = { send: DuesRecipient[]; skipped: DuesSkip[] };

/**
 * One reminder per team per period, and the index is what enforces it.
 *
 * **The period is a policy sitting inside a key**, and it should stay visible: a board that wants a
 * second reminder inside one period cannot send one, because `messages_comp_dedupe_unique` refuses
 * it. That is the right default — a double-clicked button is far likelier than a deliberate second
 * chase, and the failure it prevents is somebody's captain getting billed twice — but the first
 * founding partner who asks for a second reminder is information about this key, not a bug in it.
 */
export const duesDedupeKey = (teamId: string, period: string): string => `dues:${teamId}:${period}`;

/**
 * Who owes something and can be reached.
 *
 * A team with a contact and no address on file is **not** skipped here. The engine records that as a
 * `bounced` message carrying the reason, which is a better record than this function quietly leaving
 * it out: a board that invited somebody by name and never got an address should find that out from
 * the outbox rather than from a reminder that never appears.
 *
 * **Who a team's contact *is* is resolved by the caller and passed in**, rather than read off
 * `contactPersonId` here. That field is written by the registration form, and setup is founder-run
 * by design (PRD §12) — so every founding partner's roster is *seeded*, has no contact on any team,
 * and could not be chased at all. A captain who accepted an invitation is the same human by a
 * different door, and P1 built that door; resolving it needs a second table, which is exactly the
 * kind of thing this function must not do.
 */
export const planDuesReminders = (
  report: WhoOwes,
  roster: readonly RosterTeamView[],
  context: {
    compName: string;
    boardName: string;
    period: string;
    /** `teamId → personId`, used **only** where no contact registered. See the note above. */
    contactFor?: ReadonlyMap<string, string>;
  },
): DuesPlan => {
  const byId = new Map(roster.map((team) => [team.id, team]));
  const send: DuesRecipient[] = [];
  const skipped: DuesSkip[] = [];

  for (const row of report.rows) {
    // Only debtors. A settled team is not a gap and a credit is not a debt; `whoOwes` already
    // separates them, and chasing either is how a board loses the right to be believed.
    if (row.balanceCents <= 0) continue;

    const team = byId.get(row.teamId);
    if (!team) continue;

    // The registered contact wins and the membership is the fallback, never the override: the
    // person who filled in the form is the one who said they were the contact for this team.
    const personId = team.contactPersonId ?? context.contactFor?.get(row.teamId);
    if (!personId) {
      skipped.push({ teamId: row.teamId, teamName: row.name, reason: "no-contact" });
      continue;
    }

    send.push({
      teamId: row.teamId,
      teamName: row.name,
      personId,
      balanceCents: row.balanceCents,
      dedupeKey: duesDedupeKey(row.teamId, context.period),
      payload: {
        teamName: row.name,
        compName: context.compName,
        balance: formatCents(row.balanceCents),
        // The charge lines, not a single total: a captain who can see which obligation is short can
        // answer the board without a second email, and "what is this for" is the question the
        // $2,160 lump exists to make answerable.
        lines: team.charges.map((charge) => ({
          kind: charge.kind.replace("_", " "),
          amount: formatCents(charge.amountCents),
          paid: formatCents(charge.paidCents),
        })),
        boardName: context.boardName,
      },
    });
  }

  return { send, skipped };
};
