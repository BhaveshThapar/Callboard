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
  "invitation.created",
  "announcement.sent",
] as const satisfies readonly TemplateName[];

/** Whether a template is a thing a board sends *at* people or a thing the record owes them. */
export const TEMPLATE_KIND: Record<TemplateName, "transactional" | "broadcast"> = {
  "dues.reminder": "transactional",
  "payment.receipt": "transactional",
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
