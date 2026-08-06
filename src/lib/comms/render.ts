/**
 * Templates, pure and unit-testable — the half of the comms engine that decides what a person reads.
 *
 * No database and no clock, so a template is a function of its payload and nothing else. That is
 * what makes "what was this person actually told" answerable a season later: the payload is stored
 * as `json` (the bytes that went in), and replaying it through here reproduces the message the way
 * replaying `tab_runs.inputs` reproduces a placement.
 *
 * Plain text only. HTML mail means a tracking pixel is one line away, and ADR-0020 says this product
 * does not want to know whether a captain opened an email.
 */

export type Rendered = { subject: string; body: string };

/**
 * The payloads, one per template, each a plain record.
 *
 * They are types rather than a shared bag because the compiler is the only thing that will notice a
 * template reading a field the caller never sends — and a reminder that says "you owe $undefined" is
 * exactly the kind of wrong number this product exists to not produce.
 */
export type MessagePayloads = {
  "dues.reminder": {
    teamName: string;
    compName: string;
    balance: string;
    lines: { kind: string; amount: string; paid: string }[];
    boardName: string;
  };
  "payment.receipt": {
    teamName: string;
    compName: string;
    gross: string;
    fee: string;
    net: string;
    rail: string;
    balance: string;
  };
  /**
   * A deposit that went back. The other half of A7, and deliberately **not** `payment.receipt` with
   * a negative number in it: a refund is not a negative payment ([ADR-0015]), and a template that
   * pretended otherwise would be that mistake reappearing in the one place a team actually reads.
   *
   * There is no `forfeited` sibling. A forfeit moves no money and is a decision a board should
   * deliver itself, with a reason it is willing to say out loud — a form letter is the wrong
   * instrument for telling somebody they lost $100.
   *
   * [ADR-0015]: ../../../docs/decisions/0015-a-refund-moves-the-money.md
   */
  "deposit.returned": {
    teamName: string;
    compName: string;
    amount: string;
    balance: string;
    boardName: string;
  };
  /**
   * ADJ·2 — what a team is told after the lock.
   *
   * **There is no score in this payload and there must never be one.** A team learns where it
   * placed, what it was docked and why, and what each judge wrote under `Judge N` — the same
   * projection `toTeamFeedbackCsv` carries, for [ADR-0008](../../../docs/decisions/0008-judge-scores-are-de-identified.md)'s
   * reason: publishing numbers invites a team to litigate a 27-vs-28 on Execution, an argument no
   * board can win and no rubric can settle. Adding a field here would be the leak, so the type is
   * the enforcement.
   */
  "feedback.delivered": {
    teamName: string;
    compName: string;
    place: number;
    deductionPoints: number;
    deductionReasons: string[];
    notes: { judge: string; note: string }[];
    boardName: string;
  };
  "invitation.created": {
    personName: string;
    compName: string;
    role: string;
    invitedBy: string | null;
    url: string;
  };
  /**
   * The only **broadcast** template, and therefore the only one that has to carry a way out.
   *
   * `unsubscribeUrl` is on the payload rather than assembled at send, so there is **one** definition
   * of where the opt-out lives: the body's visible line and the `List-Unsubscribe` header are the
   * same string, read from the same field. Built at enqueue, where the person and the base URL are
   * both already in hand.
   *
   * Nullable because a deployment with no `NEXT_PUBLIC_BASE_URL` cannot form one — and when that
   * happens the announcement visibly lacks its opt-out line, which is a thing a test and a human can
   * both see. It used to be a header that silently did not get set.
   */
  "announcement.sent": {
    compName: string;
    subject: string;
    body: string;
    boardName: string;
    unsubscribeUrl: string | null;
  };
};

export type TemplateName = keyof MessagePayloads;

export const TEMPLATE_NAMES = [
  "dues.reminder",
  "payment.receipt",
  "deposit.returned",
  "feedback.delivered",
  "invitation.created",
  "announcement.sent",
] as const satisfies readonly TemplateName[];

/**
 * Which fields hold something that must not outlive the send ([ADR-0021]).
 *
 * Declared beside the templates rather than inside the outbox, because *this payload carries a
 * secret* is a fact about the template and the sweep loop is only where it is acted on. A template
 * added later with a credential in it is one line here; a template added later with a credential in
 * it and nothing here is the leak, and this list is the one place a reader would look.
 *
 * Exactly one entry, and it is the only one that should ever be easy to justify: an invitation is a
 * link, and a link is the credential itself.
 *
 * [ADR-0021]: ../../../docs/decisions/0021-the-outbox-holds-a-secret-only-until-it-sends.md
 */
export const SCRUBBED_FIELDS: Partial<Record<TemplateName, readonly string[]>> = {
  "invitation.created": ["url"],
};

/**
 * What a scrubbed field is replaced *with*, because the key is not removed.
 *
 * Deleting it would leave the stored row failing its own payload type, so a replay would render
 * `undefined` into a sentence a person supposedly read. This says what happened instead, which is
 * the honest answer to "what was in this email" for a message whose whole point was a link.
 */
export const SCRUBBED = "(link removed after sending)";

/** Whether a template is a thing a board sends *at* people or a thing the record owes them. */
export const TEMPLATE_KIND: Record<TemplateName, "transactional" | "broadcast"> = {
  "dues.reminder": "transactional",
  "payment.receipt": "transactional",
  "deposit.returned": "transactional",
  // Transactional: a team that competed is owed its feedback, and a board muting announcements
  // must not thereby be unable to deliver it.
  "feedback.delivered": "transactional",
  "invitation.created": "transactional",
  "announcement.sent": "broadcast",
};

const lines = (parts: (string | null)[]): string => parts.filter((p) => p !== null).join("\n");

/**
 * Every message is signed by a comp and a person, never by "Callboard".
 *
 * A dues reminder from a piece of software is easy to ignore and slightly insulting; one from the
 * treasurer who will be standing next to you in February is not. It is also honest — the board is
 * asking, and the product is only the paper.
 */
const signOff = (compName: string, boardName: string): string =>
  lines(["", `— ${boardName}, ${compName}`, "", "Sent through Callboard on behalf of your board."]);

const RENDER: { [K in TemplateName]: (payload: MessagePayloads[K]) => Rendered } = {
  "dues.reminder": (p) => ({
    subject: `${p.compName}: ${p.teamName} owes ${p.balance}`,
    body: lines([
      `Hi ${p.teamName},`,
      "",
      `Your balance for ${p.compName} is ${p.balance}.`,
      "",
      ...p.lines.map((line) => `  ${line.kind} — ${line.amount} (${line.paid})`),
      "",
      "If you have already paid, reply and say when and how — it may not have been",
      "matched to your team yet.",
      signOff(p.compName, p.boardName),
    ]),
  }),

  "payment.receipt": (p) => ({
    subject: `${p.compName}: received ${p.gross} from ${p.teamName}`,
    body: lines([
      `Hi ${p.teamName},`,
      "",
      `We recorded ${p.gross} by ${p.rail}.`,
      // The three integers, always, for the reason `payments` holds three: a $100 deposit that
      // arrived as $97.01 is a recorded cost and not a hole, and the team is credited the gross.
      p.fee === "$0.00" ? null : `  processing fee: ${p.fee}`,
      p.fee === "$0.00" ? null : `  net to the org: ${p.net}`,
      "",
      `Your balance is now ${p.balance}.`,
      signOff(p.compName, "your board"),
    ]),
  }),

  "deposit.returned": (p) => ({
    subject: `${p.compName}: your ${p.amount} deposit has been returned`,
    body: lines([
      `Hi ${p.teamName},`,
      "",
      `Your deposit of ${p.amount} has been returned.`,
      "",
      // Both halves move together, which is the whole of ADR-0015: the obligation is voided and the
      // money stops counting as paid, so the balance does not lurch. Saying so is what stops a
      // captain reading the refund as a new bill.
      `That clears the deposit from what you owe, so your balance is still ${p.balance}.`,
      signOff(p.compName, p.boardName),
    ]),
  }),

  "feedback.delivered": (p) => ({
    subject: `${p.compName}: feedback for ${p.teamName}`,
    body: lines([
      `Hi ${p.teamName},`,
      "",
      `You placed ${p.place}.`,
      p.deductionPoints > 0 ? `Deduction: ${p.deductionPoints} point(s).` : null,
      ...p.deductionReasons.map((reason) => `  ${reason}`),
      "",
      "What the judges wrote:",
      // A judge who scored and wrote nothing still appears, so a team can see it was judged by all
      // of them rather than wondering which one skipped it.
      ...p.notes.map((n) => `  ${n.judge}: ${n.note === "" ? "(no note)" : n.note}`),
      "",
      // Said out loud, because the absence is a decision rather than an oversight, and a team that
      // does not know that will simply ask.
      "Scores are not published — you have where you placed and what the judges said.",
      signOff(p.compName, p.boardName),
    ]),
  }),

  "invitation.created": (p) => ({
    subject: `${p.compName}: you have been added as ${p.role}`,
    body: lines([
      `Hi ${p.personName},`,
      "",
      p.invitedBy
        ? `${p.invitedBy} added you to ${p.compName} as ${p.role}.`
        : `You have been added to ${p.compName} as ${p.role}.`,
      "",
      "Set a password here — the link works once and expires in two weeks:",
      p.url,
      signOff(p.compName, p.invitedBy ?? "your board"),
    ]),
  }),

  "announcement.sent": (p) => ({
    subject: `${p.compName}: ${p.subject}`,
    body: lines([
      p.body,
      signOff(p.compName, p.boardName),
      // Written out, not left to the mail client. `List-Unsubscribe` is set from this same string,
      // but it is a header — a header is honoured by Gmail and Apple Mail and by nothing a captain
      // is reading this on at 1am. An opt-out only a mail client can find is one that a person
      // cannot use, and `people.unsubscribed_at` is only load-bearing if somebody can reach it.
      p.unsubscribeUrl ? "" : null,
      p.unsubscribeUrl ? `Stop receiving announcements: ${p.unsubscribeUrl}` : null,
      p.unsubscribeUrl ? "Receipts and anything you owe still reach you." : null,
    ]),
  }),
};

/**
 * Renders, or refuses.
 *
 * The template name arrives from a stored row rather than from a literal, so it has to be checked
 * rather than trusted: a message queued under a template that has since been renamed is a row this
 * has to survive, not throw on. The caller records the refusal against the message.
 */
export const render = <K extends TemplateName>(
  template: K,
  payload: MessagePayloads[K],
): Rendered => RENDER[template](payload);

export const isTemplate = (name: string): name is TemplateName =>
  (TEMPLATE_NAMES as readonly string[]).includes(name);

/**
 * The opt-out link a stored broadcast carries, or `null`.
 *
 * Read off the payload rather than rebuilt, so the `List-Unsubscribe` header cannot point somewhere
 * the body does not. Takes `unknown` because the caller has a row from the database: a payload
 * written before this field existed simply has no link, which is the same answer as a deployment
 * that could not form one.
 */
export const unsubscribeUrlOf = (payload: unknown): string | null => {
  if (payload === null || typeof payload !== "object") return null;
  const url = (payload as { unsubscribeUrl?: unknown }).unsubscribeUrl;
  return typeof url === "string" && url !== "" ? url : null;
};

/**
 * The payload as it should be stored once the message is gone ([ADR-0021]).
 *
 * Pure and total, and deliberately forgiving of what it is handed: the template arrives from a
 * stored row, so a renamed one gets its payload back untouched rather than throwing — a message
 * that failed to render must still be able to record that it failed.
 *
 * Returning the same reference when there is nothing to scrub is what lets the caller decide
 * whether to write the column at all, which keeps every other template's send one statement.
 *
 * [ADR-0021]: ../../../docs/decisions/0021-the-outbox-holds-a-secret-only-until-it-sends.md
 */
export const scrubPayload = (template: string, payload: unknown): unknown => {
  const fields = isTemplate(template) ? SCRUBBED_FIELDS[template] : undefined;
  if (!fields || payload === null || typeof payload !== "object") return payload;

  const scrubbed: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const field of fields) {
    if (field in scrubbed) scrubbed[field] = SCRUBBED;
  }
  return scrubbed;
};
