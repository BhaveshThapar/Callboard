/**
 * A7 — what happens to a refundable deposit, as an append-only chain.
 *
 * **A refund is not a negative payment.** `payments_gross_check` forbids one deliberately: a
 * negative gross makes `allocated_cents <= gross_cents` uninterpretable, and that ceiling is the
 * single invariant [ADR-0014] bought with a denormalized column. So a deposit's fate gets its own
 * chain, modelled on `tab_runs`: one row per transition ordered by `seq`, current state is
 * `max(seq)`'s row, and history is the rows themselves rather than something reconstructed from an
 * audit log.
 *
 * This file is the pure half — the machine, in the shape of `src/lib/roster/transitions.ts`. It has
 * no imports and reads no clock, so the whole state graph is testable without a database.
 *
 * [ADR-0014]: ../../../docs/decisions/0014-the-allocation-counter.md
 */

export const DEPOSIT_STATES = [
  "held",
  "refund_pending",
  "refunded",
  "forfeited",
  "refund_failed",
] as const;

export type DepositState = (typeof DEPOSIT_STATES)[number];

/**
 * The endings. `deposit_events_terminal_unique` is partial over exactly these, so a second one is
 * unrepresentable rather than merely guarded against — a double-clicked refund button is the
 * realistic way a deposit is returned twice, and on neon-http the check and the insert are two acts.
 * The database is the only thing that can refuse it, which is the chain indexes' argument again.
 *
 * One definition, because three things must agree on the strings and none can derive them: this
 * machine, the check constraint, and the partial index's `where`.
 */
export const TERMINAL_STATES = ["refunded", "forfeited"] as const;

export type TerminalDepositState = (typeof TERMINAL_STATES)[number];

export const isTerminal = (state: DepositState): boolean =>
  (TERMINAL_STATES as readonly string[]).includes(state);

/**
 * Total, so a state added later cannot silently have no rules.
 *
 * **`refund_failed` is not an ending**, and that is the one edge worth arguing. An ACH return that
 * bounced is a thing to retry, and calling it terminal would strand the money in a state the
 * product cannot leave — the treasurer would be looking at a deposit marked finished that is still
 * in the org's account. It returns to `held`, which is where the money actually is.
 *
 * `held → forfeited` skips the pending step on purpose: forfeiting is a decision, not a transfer,
 * so there is nothing to be pending on.
 */
const ALLOWED: Record<DepositState, readonly DepositState[]> = {
  held: ["refund_pending", "forfeited"],
  refund_pending: ["refunded", "refund_failed"],
  refund_failed: ["held", "forfeited"],
  refunded: [],
  forfeited: [],
};

export const canTransition = (from: DepositState, to: DepositState): boolean =>
  ALLOWED[from].includes(to);

export const allowedFrom = (from: DepositState): readonly DepositState[] => ALLOWED[from];

/**
 * The state a chain is in: the last row by `seq`, or `held` for a deposit nothing has happened to.
 *
 * `held` as the empty answer is not a default standing in for missing data — a deposit that has been
 * charged and paid and not yet resolved *is* held, and writing a row to say so would be recording an
 * event that never happened.
 */
export const currentState = (
  events: readonly { seq: number; state: DepositState }[],
): DepositState => {
  let latest: { seq: number; state: DepositState } | null = null;
  for (const event of events) {
    if (!latest || event.seq > latest.seq) latest = event;
  }
  return latest?.state ?? "held";
};
