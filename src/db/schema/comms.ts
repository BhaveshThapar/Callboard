import {
  check,
  index,
  integer,
  json,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { comps, people } from "./orgs";

/**
 * C2 — the outbox ([ADR-0020]).
 *
 * The first thing this product builds that acts on the outside world. Every write before it was a
 * row a board could correct: a wrong charge is voided, a wrong allocation released, a wrong score
 * superseded. **A sent email cannot be voided**, so the question here is not *is this number right*
 * but *did this happen exactly once* — and a duplicate is invisible from inside the system, because
 * two identical rows and one row look the same on every screen.
 *
 * [ADR-0020]: ../../../docs/decisions/0020-a-message-sends-once.md
 */

/** Email today. SMS arrives as a second transport behind this same outbox, not a second outbox. */
export const MESSAGE_CHANNELS = ["email"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/**
 * `queued → sending → sent | failed | bounced`.
 *
 * `failed` is **not** terminal, for `refund_failed`'s reason: a timed-out connection to a mail
 * provider is retryable, and calling it an ending strands a dues reminder nobody can ever send.
 * `bounced` is, because a hard bounce is the address being wrong rather than the network being bad.
 */
export const MESSAGE_STATES = ["queued", "sending", "sent", "failed", "bounced"] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

export const MESSAGE_TERMINAL_STATES = ["sent", "bounced"] as const;

/**
 * Whether a person may be suppressed from this kind of message.
 *
 * **`transactional` ignores an unsubscribe and `broadcast` obeys it**, and the split is at the
 * schema rather than in a caller's judgement because blurring it is how a product ends up sending
 * announcements under a receipt's legal cover. A board is entitled to tell somebody who owes them
 * money that they owe it; a board is not entitled to keep announcing at somebody who left.
 */
export const MESSAGE_KINDS = ["transactional", "broadcast"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/**
 * Named once, read by the schema, by the sentence a refusal turns into, and by `db:doctor` — the
 * three-reader rule `CHAIN_INDEXES` and `MONEY_CONSTRAINTS` established.
 */
export const COMMS_CONSTRAINTS = {
  /** **The whole guarantee.** A caller inserts rather than asking whether it already sent. */
  dedupe: "messages_comp_dedupe_unique",
  /** A message ends once. `deposit_events_terminal_unique`, one subsystem over. */
  terminal: "message_events_terminal_unique",
} as const;

export const COMMS_CONSTRAINT_NAMES: readonly string[] = Object.values(COMMS_CONSTRAINTS);

/**
 * One row per intended message.
 *
 * `state` is denormalized and **is the claim** — ADR-0014's bargain made again for a different
 * reason. The counter was denormalized because a cross-row sum cannot be a CHECK; this is
 * denormalized because *a chain cannot be claimed atomically*: appending a `sending` event does not
 * stop a second worker appending one microseconds later, and a partial index over `sending` would
 * block the retry `failed` exists to allow. So the claim is one guarded UPDATE, which takes its own
 * row lock, and a worker that gets no row back sends nothing.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    /** Who it is for. A person rather than an address, so a corrected email reaches them. */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    channel: text("channel").$type<MessageChannel>().notNull(),
    kind: text("kind").$type<MessageKind>().notNull(),
    /** Which template renders it. The body is never stored pre-rendered; the payload is. */
    template: text("template").notNull(),
    /**
     * `json`, not `jsonb`, for `tab_runs.inputs`' reason: jsonb reorders keys and collapses
     * duplicates, so it cannot promise the bytes back — and what a person was actually told is
     * exactly the kind of thing somebody asks about a season later.
     */
    payload: json("payload").notNull(),
    /**
     * The caller's sentence about what this message *is* — `dues:2027-02`, not a digest of the body.
     * A digest would make a reworded reminder a different message and send it again, which is the
     * bug this column exists to prevent rather than a subtlety about it.
     */
    dedupeKey: text("dedupe_key").notNull(),
    state: text("state").$type<MessageState>().notNull().default("queued"),
    /** Nothing is sent before this. A reminder queued on Sunday can be meant for Monday. */
    sendAfter: timestamp("send_after", { withTimezone: true }).notNull().defaultNow(),
    /** How many times a send has been attempted, so a permanently failing row stops being retried. */
    attempts: integer("attempts").notNull().default(0),
    /** The provider's own id for the accepted message, once there is one. */
    providerRef: text("provider_ref"),
    /** Every act is attributed. `null` when a schedule rather than a person queued it. */
    createdByPersonId: uuid("created_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique(COMMS_CONSTRAINTS.dedupe).on(t.compId, t.dedupeKey),
    check(
      "messages_channel_check",
      sql`${t.channel} in ${sql.raw(`(${MESSAGE_CHANNELS.map((c) => `'${c}'`).join(",")})`)}`,
    ),
    check(
      "messages_kind_check",
      sql`${t.kind} in ${sql.raw(`(${MESSAGE_KINDS.map((k) => `'${k}'`).join(",")})`)}`,
    ),
    check(
      "messages_state_check",
      sql`${t.state} in ${sql.raw(`(${MESSAGE_STATES.map((s) => `'${s}'`).join(",")})`)}`,
    ),
    check("messages_attempts_check", sql`${t.attempts} >= 0`),
    /** The claim query's index: due, unsent, oldest first. */
    index("messages_due_idx").on(t.state, t.sendAfter),
  ],
);

/**
 * What happened to a message, one row per transition. `deposit_events` applied to a smaller
 * question, and deliberately the same shape rather than a second one to get right.
 *
 * The chain is **the record**; `messages.state` is a cache of its head. The database cannot enforce
 * that they agree — the same residual ADR-0014 accepted for the allocation counter — so `db:doctor`
 * reports the disagreement by id, and reports a message stuck in `sending`, which is precisely the
 * crash-after-send footprint and the one state a human must look at rather than a machine retry.
 */
export const messageEvents = pgTable(
  "message_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Orders the chain. `created_at` cannot: two events in one act share it. */
    seq: integer("seq").generatedAlwaysAsIdentity(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    state: text("state").$type<MessageState>().notNull(),
    /** The provider's error, or the bounce reason. Read by a human, never branched on. */
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "message_events_state_check",
      sql`${t.state} in ${sql.raw(`(${MESSAGE_STATES.map((s) => `'${s}'`).join(",")})`)}`,
    ),
    // Partial over the endings only, so a message may fail and be retried as often as the network
    // demands and still finish exactly once.
    uniqueIndex(COMMS_CONSTRAINTS.terminal)
      .on(t.messageId)
      .where(
        sql`${t.state} in ${sql.raw(`(${MESSAGE_TERMINAL_STATES.map((s) => `'${s}'`).join(",")})`)}`,
      ),
    index("message_events_message_idx").on(t.messageId, t.seq),
  ],
);
