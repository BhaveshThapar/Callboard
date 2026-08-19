import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { comps } from "./orgs";

/**
 * One definition, for `MONEY_CONSTRAINTS`' reason: the schema, the webhook and `db:doctor` all have
 * to agree on these strings and none can derive them.
 */
export const STRIPE_CONSTRAINTS = {
  /** One connected account per comp. A second would split a season's money across two dashboards. */
  accountPerComp: "stripe_accounts_comp_unique",
  /**
   * **The replay guarantee.** Stripe redelivers a webhook until it gets a 2xx, and redelivers again
   * after any 5xx — so an endpoint that is not idempotent double-records a payment, which is the
   * exact failure this product is sold against, arriving through the feature meant to fix it.
   * The ask and the insert are two acts and only the index is atomic ([ADR-0020](../../../docs/decisions/0020-a-message-sends-once.md)'s
   * lesson, one table over): the handler inserts and reads the refusal.
   */
  eventOnce: "stripe_events_event_unique",
} as const;

export const STRIPE_CONSTRAINT_NAMES: readonly string[] = Object.values(STRIPE_CONSTRAINTS);

/**
 * A5 — the comp's own Stripe account, under Connect **Standard**.
 *
 * Standard rather than Express or Custom, and that is a prohibited surface rather than a preference
 * ([ADR-0005](../../../docs/decisions/0005-stripe-connect-standard-never-hold-funds.md)): funds
 * settle **directly to the org**, which owns its dashboard, its payouts and its 1099. Callboard
 * orchestrates and reconciles and never sits in the flow of funds. The answer to *"what happens to
 * our money if you disappear?"* has to be *"nothing, it was never ours"* — and for a student vendor
 * with a credibility problem that answer is worth more than a nicer onboarding flow.
 *
 * Only the account **id** is stored. Not a key, not a token, nothing that could move money: the
 * platform's own secret authorizes the call and `acct_…` merely says on whose behalf.
 */
export const stripeAccounts = pgTable(
  "stripe_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    /**
     * Stripe's own two answers about onboarding, cached at each webhook rather than asked on render.
     * They are **not** the same question: a board can finish the form (`details_submitted`) and still
     * not be able to take money (`charges_enabled`) while Stripe verifies. A screen that conflated
     * them would tell a treasurer they were ready and then fail the first payment.
     */
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),
    /**
     * A5b. Whether this account has Stripe's verified-nonprofit card rate. Stated by the board, not
     * detected: whether Stripe has *verified* the status is a fact about their dashboard, and a
     * product that guessed would quote a fee the statement then disagrees with.
     */
    nonprofitRate: boolean("nonprofit_rate").notNull().default(false),
    /**
     * A5c. Basis points of processing fee passed to the payer, disclosed at checkout. Zero means the
     * comp absorbs it. Capped at 300 by the database as well as by the arithmetic, because a comp
     * that set 4% would get no warning from Stripe — it would get a rule violation months later.
     */
    surchargeBp: integer("surcharge_bp").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex(STRIPE_CONSTRAINTS.accountPerComp).on(t.compId),
    check("stripe_accounts_surcharge_check", sql`${t.surchargeBp} between 0 and 300`),
  ],
);

/**
 * Every Stripe event this endpoint has already acted on.
 *
 * **A row here is the receipt for having handled it**, and the unique index is what makes a
 * redelivery a no-op rather than a second payment. Stripe retries for days on any non-2xx, so this
 * is not a rare path — it is the ordinary one the first time a deploy is slow.
 *
 * Kept even after the payment is recorded, and never cleaned up on a schedule: the whole value is in
 * the row that already exists when the duplicate arrives.
 */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stripe's own `evt_…`. The thing that is actually unique. */
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    accountId: text("account_id"),
    /** Null when the event named no comp we know — recorded anyway, so it is not silently dropped. */
    compId: uuid("comp_id").references(() => comps.id, { onDelete: "cascade" }),
    handledAt: timestamp("handled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex(STRIPE_CONSTRAINTS.eventOnce).on(t.eventId)],
);
