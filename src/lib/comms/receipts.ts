/**
 * A7's missing half — the receipt.
 *
 * `payments` has recorded gross, fee and net since the ledger shipped, and nothing ever told the
 * team any of it. A treasurer entering a $2,160 Venmo lump had no way to say *we got it* except by
 * texting a screenshot, which is the manual work the record was supposed to replace.
 *
 * Pure, for `dues.ts`' reason: what a receipt *says* is a function of the payment and the roster,
 * and it must read the same tomorrow. The caller enqueues.
 */
import type { RosterTeamView } from "@/lib/auth/scope";
import { formatCents } from "@/lib/money/format";
import { contactPersonFor } from "./contact";
import type { MessagePayloads } from "./render";

export type ReceiptPlan = {
  personId: string;
  dedupeKey: string;
  payload: MessagePayloads["payment.receipt"];
};

/**
 * One receipt per payment, keyed on the payment itself.
 *
 * Unlike the dues key this carries **no period and no policy**: a payment is a single event with an
 * id, so "already receipted" is a fact rather than a window someone chose. A retried form submit, a
 * double-clicked button and a replayed import all collapse to the same row.
 */
export const receiptDedupeKey = (paymentId: string): string => `receipt:${paymentId}`;

export type DepositReturnedPlan = {
  personId: string;
  dedupeKey: string;
  payload: MessagePayloads["deposit.returned"];
};

/**
 * A deposit ends once, so its notice is keyed on the team and needs no period.
 *
 * `deposit_events_terminal_unique` already makes a second ending unrepresentable at the database,
 * which means this key is a restatement of a guarantee rather than a policy — unlike the dues key,
 * where the period is a choice somebody made.
 */
export const depositReturnedDedupeKey = (teamId: string): string => `deposit-returned:${teamId}`;

/**
 * What to tell a team whose deposit went back, or `null` when there is nobody to tell.
 *
 * The balance is read after the refund and is expected **not to have moved**: `refunded` voids the
 * obligation and releases its allocations, so `owed` and `paid` fall together (ADR-0015). Saying the
 * balance out loud is what stops a captain reading a returned deposit as a fresh bill.
 */
export const planDepositReturned = (
  team: RosterTeamView,
  captains: ReadonlyMap<string, string>,
  deposit: { amountCents: number },
  context: { compName: string; boardName: string },
): DepositReturnedPlan | null => {
  const personId = contactPersonFor(team, captains);
  if (!personId) return null;

  return {
    personId,
    dedupeKey: depositReturnedDedupeKey(team.id),
    payload: {
      teamName: team.name,
      compName: context.compName,
      amount: formatCents(deposit.amountCents),
      balance: formatCents(team.balance.balanceCents),
      boardName: context.boardName,
    },
  };
};

/**
 * What to tell a team that a payment arrived, or `null` when there is nobody to tell.
 *
 * The balance is the team's balance **after** the payment, which is why the caller re-reads the
 * roster rather than doing arithmetic here: `paid` is every cent that arrived and `owed` moves when
 * a charge is voided, so a receipt computing its own total would be a second definition of the one
 * number this product exists to get right.
 */
export const planPaymentReceipt = (
  team: RosterTeamView,
  captains: ReadonlyMap<string, string>,
  payment: { id: string; grossCents: number; feeCents: number; rail: string },
  context: { compName: string },
): ReceiptPlan | null => {
  const personId = contactPersonFor(team, captains);
  if (!personId) return null;

  return {
    personId,
    dedupeKey: receiptDedupeKey(payment.id),
    payload: {
      teamName: team.name,
      compName: context.compName,
      gross: formatCents(payment.grossCents),
      fee: formatCents(payment.feeCents),
      net: formatCents(payment.grossCents - payment.feeCents),
      rail: payment.rail,
      balance: formatCents(team.balance.balanceCents),
    },
  };
};
