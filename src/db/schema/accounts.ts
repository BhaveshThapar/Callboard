import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { comps, orgs, people } from "./orgs";
import { teams } from "./teams";

/**
 * P1 — accounts for people who stay, links for people who visit ([ADR-0016]).
 *
 * A judge still authenticates with a token in a URL, because a judge scores once as a favour and an
 * account is friction charged to a volunteer. Everyone who comes back — board, captain, liaison —
 * gets a login, because every remaining person-facing feature on the map has to reach one specific
 * human on a Tuesday in February, and ADR-0011's mitigation ("the founder runs the seed and keeps
 * the output") does not survive contact with a dues reminder.
 *
 * [ADR-0016]: ../../../docs/decisions/0016-accounts-for-people-who-stay-links-for-people-who-visit.md
 */

/**
 * What an account may do at a comp. Deliberately **not** `CompRole`: that enum describes what a
 * person *is* at a comp (including `attendee`, who has no account and never will), while this says
 * what a session is allowed to resolve to. Two questions, two lists — `BILLABLE_STATUSES` and
 * `SCOREABLE_STATUSES`' reason, which equal each other today and answer different things.
 */
export const ACCOUNT_ROLES = ["board", "captain", "liaison"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/**
 * The constraints that make a broken credential state unrepresentable rather than merely unlikely.
 * Named once, for `CHAIN_INDEXES`' and `MONEY_CONSTRAINTS`' reason: the schema declares them, the
 * auth paths read one off a failed insert to say something true to a person, and `db:doctor` looks
 * them up to prove the guarantee is live on the database in front of it.
 */
export const ACCOUNT_CONSTRAINTS = {
  /** One login per email per org. Two would make "who is this" ambiguous at the door. */
  userOrgEmail: "users_org_email_unique",
  /** A session token resolves to at most one session. */
  sessionToken: "sessions_token_unique",
  /** An invitation token is single-use by identity, not merely by convention. */
  inviteToken: "invitations_token_unique",
  /** One live invitation per person per comp per role — a re-invite supersedes, never duplicates. */
  inviteLive: "invitations_live_unique",
  /** One membership per (person, comp, role). */
  membershipUnique: "memberships_unique",
} as const;

export const ACCOUNT_CONSTRAINT_NAMES: readonly string[] = Object.values(ACCOUNT_CONSTRAINTS);

/**
 * A login. Org-scoped, and pointed at a `person` rather than replacing one.
 *
 * `person_id` is the identity and this row is only the credential, so a liaison who is also on the
 * board is **one human with one password and two memberships** — which is the normal case at a
 * student comp and is unrepresentable while authority lives in per-role tokens.
 *
 * `password_hash` is argon2id. It is nullable for exactly one window: an invited person exists as a
 * row before they have chosen a password, and the invitation is what lets them set it.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** Lowercased on write. Postgres `citext` is an extension; one definition in code is cheaper. */
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Killing an account without deleting the person who did things under it. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique(ACCOUNT_CONSTRAINTS.userOrgEmail).on(t.orgId, t.email),
    check("users_email_lower_check", sql`${t.email} = lower(${t.email})`),
  ],
);

/**
 * What an account may do, and where. One row per (person, comp, role).
 *
 * Separate from `users` because authority is per comp and a login is per org: a captain at one comp
 * is nobody at the next one, and the board that ran last season should not silently still be the
 * board. Separate from `comp_roles` because that table describes participation — it carries
 * `attendee`, and it authorizes nothing — while this grants.
 *
 * `team_id` is set exactly when `role = 'captain'`, and the CHECK says so rather than a comment: a
 * captain with no team could see nothing, and a liaison with a team would imply a claim nothing
 * reads.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    compId: uuid("comp_id")
      .notNull()
      .references(() => comps.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: text("role").$type<AccountRole>().notNull(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique(ACCOUNT_CONSTRAINTS.membershipUnique).on(t.compId, t.personId, t.role),
    check(
      "memberships_role_check",
      sql`${t.role} in ${sql.raw(`(${ACCOUNT_ROLES.map((r) => `'${r}'`).join(",")})`)}`,
    ),
    check(
      "memberships_captain_team_check",
      sql`(${t.role} = 'captain') = (${t.teamId} is not null)`,
    ),
  ],
);

/**
 * A live login session.
 *
 * The token gets exactly the treatment ADR-0003 gave a judge link: 32 random bytes in the client's
 * cookie, sha256 in the database, and the raw value never stored. **Not a JWT** — a stateless
 * session cannot be revoked, and revocability is the property ADR-0011 spent a whole decision on.
 * A leaked session must be killable from a screen, which means it has to be a row.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** For the "sign out everywhere else" screen: which device this was. Never parsed, only shown. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique(ACCOUNT_CONSTRAINTS.sessionToken).on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/** What a single-use token is for. Both expire; neither survives being spent. */
export const TOKEN_PURPOSES = ["invite", "verify_email", "reset_password"] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

/**
 * The minting path ADR-0011 refused and ADR-0016 authorizes — an invitation, not a link handed over
 * in a text message.
 *
 * The difference matters and is the reason this is a table rather than a longer-lived token: an
 * invitation names **who it is for** before it is accepted, so accepting it cannot make you somebody
 * else, and it is spent exactly once. A judge link is bearer authority forever; this is not.
 *
 * `invitations_live_unique` is partial over unspent, unrevoked rows, so re-inviting somebody
 * supersedes rather than leaving two valid envelopes in the world.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** Null for `verify_email` and `reset_password`, which are about a login rather than a comp. */
    compId: uuid("comp_id").references(() => comps.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<TokenPurpose>().notNull(),
    /** Null unless `purpose = 'invite'`. What accepting this grants. */
    role: text("role").$type<AccountRole>(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Every act is attributed. An invitation is a board member vouching for somebody. */
    createdByPersonId: uuid("created_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique(ACCOUNT_CONSTRAINTS.inviteToken).on(t.tokenHash),
    /**
     * Partial over the *unspent* ones, so re-inviting somebody supersedes rather than leaving two
     * valid envelopes addressed to the same person. The `deposit_events_terminal_unique` shape: the
     * read and the insert are two acts on neon-http, and only the database can refuse the second.
     */
    uniqueIndex(ACCOUNT_CONSTRAINTS.inviteLive)
      .on(t.compId, t.personId, t.role)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null and ${t.purpose} = 'invite'`),
    check(
      "invitations_purpose_check",
      sql`${t.purpose} in ${sql.raw(`(${TOKEN_PURPOSES.map((p) => `'${p}'`).join(",")})`)}`,
    ),
    // An invite grants a role at a comp; the other two purposes grant neither and must not pretend to.
    check(
      "invitations_invite_shape_check",
      sql`(${t.purpose} = 'invite') = (${t.role} is not null and ${t.compId} is not null)`,
    ),
    check(
      "invitations_captain_team_check",
      sql`(${t.role} = 'captain') = (${t.teamId} is not null)`,
    ),
  ],
);
