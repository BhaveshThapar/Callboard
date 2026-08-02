/**
 * A failed money write, as a sentence a treasurer can act on.
 *
 * Split out of `./ledger` for `health.ts`'s reason and `deposit.ts`'s: that module imports `@/db`,
 * which reads `DATABASE_URL` the moment it loads, so nothing inside it can be unit-tested at all.
 * This mapping is the part most worth testing and the part least in need of a database — it is the
 * ledger's whole claim that **a database error is read by its `constraint`, never by its message**,
 * and it had no test because of where it happened to live.
 *
 * The **third** reader of `violatedConstraint`, and it means a third thing by it: `lockAction` reads
 * a chain index as a *refusal* (there must not be a second root), `apply` reads the bid-code unique
 * as a *retry* (the applicant did nothing wrong), and this reads a money constraint as *an
 * explanation*. What all three share is that none may guess from the message text — drizzle's own
 * `message` is the failed SQL, and `Failed query: insert into "payments" ...` is not a thing to show
 * someone reconciling a bank statement.
 */
import { violatedConstraint } from "@/db/errors";
import { MONEY_CONSTRAINTS } from "@/db/schema/money";

export const UNKNOWN_REFUSAL =
  "Could not record that payment. Nothing was saved — reload and try again.";

export const refusalFor = (error: unknown): string | null => {
  switch (violatedConstraint(error)) {
    case MONEY_CONSTRAINTS.allocatedCeiling:
      return "That would allocate more than this payment is worth. Someone may have allocated part of it already — reload and check what is left.";
    case MONEY_CONSTRAINTS.netIdentity:
      return "The net does not equal gross minus fee. Enter what the bank actually shows rather than a rounded figure.";
    case MONEY_CONSTRAINTS.externalRef:
      return "A payment with that reference is already recorded for this comp. It has not been recorded twice.";
    case MONEY_CONSTRAINTS.liveAllocation:
      return "Part of this payment is already applied to that charge. Release the existing allocation and apply it again.";
    case MONEY_CONSTRAINTS.refundedCeiling:
      return "That would return more than this payment ever brought in.";
    // The idempotency index behind `planCharges`. It fires when two acts bill the same team for the
    // same thing at once -- two board members regenerating, or a status move racing a room count --
    // and it had no sentence, so a treasurer got the generic one. Nothing was billed twice, and that
    // is the part worth saying: the index is what makes clicking regenerate safe by construction.
    case MONEY_CONSTRAINTS.liveChargeKind:
      return "Somebody else billed that team for the same thing a moment ago. Nothing was billed twice — reload to see what it owes.";
    default:
      return null;
  }
};
