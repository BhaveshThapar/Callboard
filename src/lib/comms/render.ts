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
  "announcement.sent": {
    compName: string;
    subject: string;
    body: string;
    boardName: string;
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
    body: lines([p.body, signOff(p.compName, p.boardName)]),
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
