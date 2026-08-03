import type { MessageState } from "@/db/schema/comms";
import { MESSAGE_TERMINAL_STATES } from "@/db/schema/comms";

/**
 * The pure machine, beside `./outbox` the way `src/lib/money/deposit.ts` sits beside `deposits.ts`.
 *
 * No database, no clock. `now` is an argument everywhere it is needed, for `src/lib/fees/`'s reason:
 * "is this message due" and "has this one been sending too long" are both questions about a moment,
 * and a module that reads the clock can only ever answer them about this one.
 */

/**
 * Total, so a state added to the union without rules is a type error rather than a message that
 * silently cannot move. `ALLOWED` is module-private for the same reason it is in
 * `roster/transitions.ts`: the answer is `canTransition`, not the table.
 */
const ALLOWED: Record<MessageState, readonly MessageState[]> = {
  queued: ["sending"],
  // A send that failed is retried from `failed`, not from `sending` — going back would make the
  // claim reversible, and the claim is the only thing stopping two workers sending the same row.
  sending: ["sent", "failed", "bounced"],
  failed: ["sending"],
  sent: [],
  bounced: [],
};

export const canTransition = (from: MessageState, to: MessageState): boolean =>
  ALLOWED[from].includes(to);

export const allowedFrom = (from: MessageState): readonly MessageState[] => ALLOWED[from];

const TERMINAL: readonly MessageState[] = MESSAGE_TERMINAL_STATES;

export const isTerminal = (state: MessageState): boolean => TERMINAL.includes(state);

/** The head of the chain. Empty means `queued`: a message exists before anything happens to it. */
export const currentState = (
  events: readonly { seq: number; state: MessageState }[],
): MessageState =>
  events.reduce<{ seq: number; state: MessageState } | null>(
    (head, event) => (head === null || event.seq > head.seq ? event : head),
    null,
  )?.state ?? "queued";

/**
 * How many times a send is attempted before it stops being retried and starts being a thing a human
 * looks at.
 *
 * Small on purpose. A mail provider that has refused five times is not going to accept the sixth,
 * and the cost of guessing high is a person's inbox — which, unlike every other write in this
 * product, cannot be corrected afterwards.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Exponential backoff, in milliseconds, for the retry after `attempts` failures.
 *
 * Returned rather than slept: nothing in a serverless function should hold a timer open, and the
 * next cron tick is the thing that actually retries.
 */
export const backoffMs = (attempts: number): number =>
  Math.min(2 ** Math.max(0, attempts) * 60_000, 6 * 3_600_000);

export type Claimable = {
  state: MessageState;
  sendAfter: Date;
  attempts: number;
};

/**
 * Whether this row is worth claiming now.
 *
 * Pure, so the decision is testable without a database, and the query that finds candidates is a
 * narrowing of exactly this rather than a second definition of it — the shape `planCharges` and
 * `syncCharges` have, where the pure function decides and the impure one applies.
 */
export const isDue = (message: Claimable, now: Date): boolean =>
  (message.state === "queued" || message.state === "failed") &&
  message.attempts < MAX_ATTEMPTS &&
  message.sendAfter.getTime() <= now.getTime();

/**
 * A message that was claimed and never resolved — the crash-after-send footprint.
 *
 * **Deliberately not auto-retried.** A worker that sent and died before recording it leaves exactly
 * this, and retrying would email somebody twice; the whole product is built on not silently doing
 * things. So this is what `db:doctor` reports and a human decides about, which is worse ergonomics
 * and better behaviour.
 *
 * `claimedAt` is the `sending` event's own timestamp, read off the chain rather than cached in a
 * column on `messages`. The chain is the record; adding a column would be a second place for the
 * same fact to live, and the drift between them is the thing the doctor already has to report.
 */
export const STUCK_AFTER_MS = 15 * 60_000;

export const isStuck = (
  message: { state: MessageState; claimedAt: Date | null },
  now: Date,
): boolean =>
  message.state === "sending" &&
  message.claimedAt !== null &&
  now.getTime() - message.claimedAt.getTime() > STUCK_AFTER_MS;
