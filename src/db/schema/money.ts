import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ChargeKind } from "@/lib/fees/types";
import { CHARGE_KINDS } from "@/lib/fees/types";
import type { DepositState } from "@/lib/money/deposit";
import { DEPOSIT_STATES, TERMINAL_STATES } from "@/lib/money/deposit";
import { comps, people } from "./orgs";
import { teams } from "./teams";

/**
 * Rails we record. Not rails we route — nothing in this repo moves money, so every `payments` row
 * is hand-entered today. That is the design and not a stopgap: a ledger that cannot represent a
 * Venmo transfer is a ledger a board keeps a second spreadsheet beside.
 */
export const PAYMENT_RAILS = ["card", "ach", "venmo", "zelle", "check", "cash"] as const;

export type PaymentRail = (typeof PAYMENT_RAILS)[number];

/**
 * The constraints that make a wrong money state unrepresentable rather than merely unlikely.
 *
 * Named once, here, for `CHAIN_INDEXES`' reason: three places must agree on strings none of them
 * can derive. The schema declares them; the ledger reads one off a failed write's `cause` to turn
 * it into a sentence a treasurer can act on; and `doctor` looks them up to prove the guarantee is
 * live on the database in front of it rather than merely intended. See [ADR-0014].
 *
 * [ADR-0014]: ../../../docs/decisions/0014-the-allocation-counter.md
 */
export const MONEY_CONSTRAINTS = {
  /** A payment is never allocated past what was paid. */
  allocatedCeiling: "payments_allocated_check",
  /** `net = gross - fee`, refused rather than silently supplied. */
  netIdentity: "payments_net_identity_check",
  /** One live obligation per (team, kind). This is the whole idempotency story. */
  liveChargeKind: "charges_live_kind_unique",
  /** A replayed webhook or a re-imported CSV is refused, not counted twice. */
  externalRef: "payments_external_ref_unique",
  /** One live allocation per (payment, charge). */
  liveAllocation: "payment_allocations_live_unique",
  /** A deposit ends once. A double-clicked refund button is how it would end twice. */
  depositTerminal: "deposit_events_terminal_unique",
} as const;

export const MONEY_CONSTRAINT_NAMES: readonly string[] = Object.values(MONEY_CONSTRAINTS);

/**
 * What a comp charges, as data. Authored in the comp config like the rubric, because it arrives
 * from a treasurer through INTAKE.md rather than through a screen.
 *
 * One row per comp: a second schedule would make "what does this team owe" ambiguous, and the
 * ambiguity would be discovered by a team that was billed twice.
 */
export const feeSchedules = pgTable(
  "fee_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    perDancerCents: integer("per_dancer_cents").notNull().default(0),
    perRoomCents: integer("per_room_cents").notNull().default(0),
    depositCents: integer("deposit_cents").notNull().default(0),
    lateFeeCents: integer("late_fee_cents").notNull().default(0),
    /** The date the late fee starts applying. A date, not a timestamp: boards think in days. */
    lateAfter: date("late_after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fee_schedules_comp_unique").on(t.compId),
    check(
      "fee_schedules_cents_check",
      sql`${t.perDancerCents} >= 0 and ${t.perRoomCents} >= 0 and ${t.depositCents} >= 0 and ${t.lateFeeCents} >= 0`,
    ),
  ],
);

/**
 * One row per obligation. Generated from the fee schedule and the team's roster, so nobody computes
 * a total by hand — which is the thing that produced a season sheet reading $2,837.47 beside a note
 * saying "true amount around 8k".
 */
export const charges = pgTable(
  "charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ChargeKind>().notNull(),
    amountCents: integer("amount_cents").notNull(),
    dueAt: date("due_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Voided, never deleted. Deleting a charge that has money against it destroys the record of
     * what a payment was *for*, and the hard case needs that record: a team that paid $1,120 and
     * then dropped reads `owed 0 / paid 1120 / balance -1120`. The org owes them, stated in the
     * product rather than discovered in April.
     */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedReason: text("voided_reason"),
  },
  (t) => [
    check(
      "charges_kind_check",
      sql`${t.kind} in ${sql.raw(`(${CHARGE_KINDS.map((k) => `'${k}'`).join(",")})`)}`,
    ),
    // A revision is a void plus an insert. A negative amount would be a second mechanism for "owes
    // less than we said", and it is the one that makes a sum() report quietly wrong instead of loud.
    check("charges_amount_check", sql`${t.amountCents} > 0`),
    // Partial on `voided_at is null`, which is what makes regeneration idempotent *without*
    // resurrecting history. A team that paid, dropped and came back is not blocked by its own
    // voided rows, and its old allocations still count as paid -- so it reads paid, not owing.
    uniqueIndex(MONEY_CONSTRAINTS.liveChargeKind)
      .on(t.teamId, t.kind)
      .where(sql`${t.voidedAt} is null`),
  ],
);

/**
 * Money that arrived. Three integers rather than one, because BU Dheem's $100 deposit landed as
 * $97.01: the team's obligation is settled by the gross, the org's bank shows the net, and the
 * difference is a recorded cost rather than a $2.99 hole in the books.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    rail: text("rail").$type<PaymentRail>().notNull(),
    grossCents: integer("gross_cents").notNull(),
    feeCents: integer("fee_cents").notNull().default(0),
    netCents: integer("net_cents").notNull(),
    /**
     * How much of this payment is spoken for. Denormalized on purpose, and it is the only such
     * number in the schema: the ceiling `sum(allocations) <= gross` spans rows, so a CHECK cannot
     * see it. This one it can. Moved only by `allocated_cents = allocated_cents + $n` -- a single
     * atomic read-modify-write that takes its own row lock, so racing allocators serialize and the
     * check fires inside the same statement that moved the number.
     */
    allocatedCents: integer("allocated_cents").notNull().default(0),
    externalRef: text("external_ref"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    /** Every board action is attributed. A payment is a board member asserting money arrived. */
    recordedByPersonId: uuid("recorded_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    check(
      "payments_rail_check",
      sql`${t.rail} in ${sql.raw(`(${PAYMENT_RAILS.map((r) => `'${r}'`).join(",")})`)}`,
    ),
    check("payments_gross_check", sql`${t.grossCents} > 0 and ${t.feeCents} >= 0`),
    // A CHECK, not a generated column. A generated column *supplies* the right answer, so an
    // import claiming net 9701 where gross - fee says 9702 lands cleanly and the disagreement
    // disappears. The ~$5k gap is made entirely of discrepancies nobody was shown.
    check(MONEY_CONSTRAINTS.netIdentity, sql`${t.netCents} = ${t.grossCents} - ${t.feeCents}`),
    check(
      MONEY_CONSTRAINTS.allocatedCeiling,
      sql`${t.allocatedCents} >= 0 and ${t.allocatedCents} <= ${t.grossCents}`,
    ),
    // A replayed webhook or a re-imported CSV is a duplicate payment, and a duplicate payment is a
    // team told it is paid up when it is not. Scoped to the comp: two comps can see the same bank
    // reference, and neither is wrong.
    uniqueIndex(MONEY_CONSTRAINTS.externalRef)
      .on(t.compId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
  ],
);

/**
 * The unbundler. NCSU sent one payment of $2,160 labeled "hotel, security deposit & reg fees" --
 * one `payments` row and three of these. A payment never points at a charge directly, so one
 * payment can settle many obligations and one obligation can be settled by many payments.
 */
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => charges.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Voided rather than deleted, for `charges.voided_at`'s reason: the record is the point. */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [
    check("payment_allocations_amount_check", sql`${t.amountCents} > 0`),
    uniqueIndex(MONEY_CONSTRAINTS.liveAllocation)
      .on(t.paymentId, t.chargeId)
      .where(sql`${t.voidedAt} is null`),
  ],
);

/**
 * What happened to a refundable deposit, one row per transition — the `tab_runs` chain applied to a
 * smaller question. Nothing is ever updated: the current state is `max(seq)`'s row and the history
 * is the rows themselves, so "who refunded this and when" is answerable without reconstructing it
 * from an audit log.
 *
 * A refund is deliberately **not** a negative `payments` row: negative gross would make
 * `allocated_cents <= gross_cents` uninterpretable, and that ceiling is what ADR-0014 bought.
 *
 * One INSERT plus one audit row, so this stays on `db` with no transaction. There is no invariant
 * spanning statements here — the *index* refuses a second ending, which is the chain-index argument
 * rather than the `withTransaction` one.
 */
export const depositEvents = pgTable(
  "deposit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Orders the chain. `created_at` cannot: two events in one transaction share it. */
    seq: integer("seq").generatedAlwaysAsIdentity(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    /** The `kind = 'deposit'` charge this is about. */
    chargeId: uuid("charge_id")
      .notNull()
      .references(() => charges.id, { onDelete: "cascade" }),
    state: text("state").$type<DepositState>().notNull(),
    reason: text("reason"),
    /** Every board action is attributed. Returning money is emphatically a board action. */
    createdByPersonId: uuid("created_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "deposit_events_state_check",
      sql`${t.state} in ${sql.raw(`(${DEPOSIT_STATES.map((s) => `'${s}'`).join(",")})`)}`,
    ),
    // Partial over the endings only, so a deposit may pass through `refund_pending` and
    // `refund_failed` as often as reality demands and still finish exactly once.
    uniqueIndex(MONEY_CONSTRAINTS.depositTerminal)
      .on(t.chargeId)
      .where(sql`${t.state} in ${sql.raw(`(${TERMINAL_STATES.map((s) => `'${s}'`).join(",")})`)}`),
  ],
);
