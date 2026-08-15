import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { orgs, people } from "./orgs";

/**
 * The index name in one place, so the schema and anything that later reads a refusal agree on the
 * string. Deliberately **not** added to `db:doctor`, unlike `CHAIN_INDEXES` and `MONEY_CONSTRAINTS`:
 * those guard a wrong *number* -- a forked locked result, an over-allocated payment -- and this
 * guards a nuisance. Two live connections would mean a board reconnected and the old row lingered,
 * which costs nobody money and is visible on the screen that lists it.
 */
export const DRIVE_INDEXES = {
  /** An org has at most one live Google connection. A reconnect supersedes rather than stacks. */
  liveConnection: "drive_connections_live_unique",
} as const;

/**
 * A11's on-ramp: a Google account an org has connected so a board can import a roster it already
 * keeps in Sheets.
 *
 * **Org-scoped, not comp-scoped.** The thing connected is a Google account, and an org that runs two
 * divisions runs two comps ([ADR-0010](../../../docs/decisions/0010-a-comp-is-one-division.md)) off
 * the same Drive. Keying this to a comp would make a board reconnect for each one, and would leave a
 * second copy of the same refresh token in the database for no benefit.
 *
 * **`refresh_token_sealed` is the only recoverable secret in this schema**, and the exception is
 * argued in `src/lib/drive/sealed.ts`: every other credential here is a hash, because the product
 * only has to recognise those. A refresh token has to be *replayed at Google*, so it is encrypted at
 * rest instead — and it is never selected into a view. `DriveConnectionView` carries the account's
 * email and not this column, so a page cannot leak what it cannot name.
 *
 * **`revoked_at`, never `DELETE`**, for `charges.voided_at`'s reason: which account a roster was
 * imported from is a fact about how the record came to exist, and deleting the row destroys it. It
 * is also what ADR-0011 asks for — a credential the product holds must be killable, and a board
 * disconnecting Drive must actually end the product's access rather than hide the button.
 */
export const driveConnections = pgTable(
  "drive_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** Which Google account this is, so a board can see whose Drive it is reading. Display only. */
    googleEmail: text("google_email").notNull(),
    /** `aes-256-gcm$iv$tag$ciphertext`. Never selected into anything that reaches a page. */
    refreshTokenSealed: text("refresh_token_sealed").notNull(),
    /**
     * What Google actually granted, which is not always what was asked for -- a person can decline
     * a scope on the consent screen and still complete the flow. Stored so a failed import can say
     * *this connection was never given read access* rather than reporting an opaque 403.
     */
    grantedScope: text("granted_scope").notNull(),
    connectedByPersonId: uuid("connected_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex(DRIVE_INDEXES.liveConnection)
      .on(t.orgId)
      .where(sql`${t.revokedAt} is null`),
    index("drive_connections_org_idx").on(t.orgId),
  ],
);
