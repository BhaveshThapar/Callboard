/**
 * The database half of P1, split from the pure `./credentials` the way `src/lib/money/deposits.ts`
 * is split from `./deposit` — and for the same reason it was split there: this file imports `@/db`,
 * which reads `DATABASE_URL` at load, so nothing inside it can be unit-tested.
 *
 * Everything here is about one question: **which human is this, and what may they do at this comp.**
 * Answering it takes two lookups rather than one, because a login is per org and authority is per
 * comp — a captain at one comp is nobody at the next, and a board that ran last season should not
 * silently still be the board ([ADR-0016]).
 *
 * [ADR-0016]: ../../../docs/decisions/0016-accounts-for-people-who-stay-links-for-people-who-visit.md
 */
import { and, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, withTransaction } from "@/db";
import { violatedConstraint } from "@/db/errors";
import {
  ACCOUNT_CONSTRAINTS,
  comps,
  invitations,
  memberships,
  people,
  sessions,
  teams,
  users,
} from "@/db/schema";
import type { AccountRole } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import type { LiaisonActor, TeamActor } from "./scope";
import {
  inviteExpiry,
  isEmail,
  isLive,
  normalizeEmail,
  sessionExpiry,
  checkPassword,
} from "./credentials";
import { burnPasswordTime, hashPassword, verifyPassword } from "./password";
import { createToken, hashToken } from "./token";

export type AccountResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * One sentence for every way a sign-in fails, and it never says which half was wrong.
 *
 * "No such account" and "wrong password" as separate messages turn the login form into an oracle for
 * whether a given person has an account here — and the emails on this product are a board roster, so
 * knowing who is on it is worth something. `burnPasswordTime` closes the timing half of the same
 * leak; this closes the wording half.
 */
const BAD_CREDENTIALS = "That email and password do not match an account.";

/** The clock, read once on the impure side and passed into everything pure. `today()`'s pattern. */
const now = (): Date => new Date();

export type SignedIn = { token: string; userId: string; personId: string };

export const signIn = async (
  rawEmail: string,
  password: string,
  userAgent: string | null,
): Promise<AccountResult<SignedIn>> => {
  const email = normalizeEmail(rawEmail);

  const [user] = await db
    .select({
      id: users.id,
      personId: users.personId,
      passwordHash: users.passwordHash,
      disabledAt: users.disabledAt,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Burn the time a real verification would cost, so an unknown email and a wrong password are
  // indistinguishable from the outside in both wording and duration.
  if (!user || !user.passwordHash || user.disabledAt) {
    await burnPasswordTime();
    return { ok: false, message: BAD_CREDENTIALS };
  }

  const check = await verifyPassword(password, user.passwordHash);
  if (!check.ok) return { ok: false, message: BAD_CREDENTIALS };

  if (!user.emailVerifiedAt) {
    return {
      ok: false,
      message: "That account still needs its email confirmed. Check for the confirmation link.",
    };
  }

  // The one moment a plaintext password exists is the only moment an old hash can be upgraded, which
  // is what makes raising the cost a thing that happens gradually rather than never.
  if (check.needsRehash) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, user.id));
  }

  const at = now();
  const { token, tokenHash } = createToken();
  await db.insert(sessions).values({
    userId: user.id,
    tokenHash,
    expiresAt: sessionExpiry(at),
    userAgent,
  });
  await db.update(users).set({ lastLoginAt: at }).where(eq(users.id, user.id));

  return { ok: true, value: { token, userId: user.id, personId: user.personId } };
};

export const signOut = async (token: string): Promise<void> => {
  await db
    .update(sessions)
    .set({ revokedAt: now() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
};

export type SessionUser = { userId: string; personId: string; orgId: string; email: string };

/**
 * Who is holding this cookie — org identity only, with no comp in it.
 *
 * Deliberately not an `Actor`: an `Actor` carries a `compId` and is the thing every scoped read
 * demands, and a session on its own does not know which comp is being looked at. Resolving the two
 * separately is what stops a session at one comp becoming authority at another.
 */
export const resolveSessionUser = async (token: string): Promise<SessionUser | null> => {
  const [row] = await db
    .select({
      userId: users.id,
      personId: users.personId,
      orgId: users.orgId,
      email: users.email,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  if (!row || row.disabledAt) return null;
  if (!isLive({ expiresAt: row.expiresAt, revokedAt: row.revokedAt }, now())) return null;

  return { userId: row.userId, personId: row.personId, orgId: row.orgId, email: row.email };
};

export type Membership = {
  compId: string;
  compName: string;
  role: AccountRole;
  teamId: string | null;
  personName: string;
};

/** What this person may do at this comp, or null. The second of the two lookups. */
export const membershipFor = async (
  personId: string,
  compId: string,
  role: AccountRole,
): Promise<Membership | null> => {
  const [row] = await db
    .select({
      compId: comps.id,
      compName: comps.name,
      role: memberships.role,
      teamId: memberships.teamId,
      personName: people.name,
    })
    .from(memberships)
    .innerJoin(comps, eq(comps.id, memberships.compId))
    .innerJoin(people, eq(people.id, memberships.personId))
    .where(
      and(
        eq(memberships.personId, personId),
        eq(memberships.compId, compId),
        eq(memberships.role, role),
        isNull(memberships.revokedAt),
      ),
    )
    .limit(1);

  return row ?? null;
};

/**
 * A session plus a comp becomes an actor, or it does not.
 *
 * Two lookups rather than one, and the separation is the security property: `resolveSessionUser`
 * says which human is holding the cookie, and `membershipFor` says what that human may do *here*.
 * A session that is perfectly valid at one comp resolves to `null` at the next, which is what stops
 * a captain from becoming a captain everywhere.
 */
export const resolveTeamActor = async (
  token: string,
  compId: string,
): Promise<TeamActor | null> => {
  const user = await resolveSessionUser(token);
  if (!user) return null;

  const membership = await membershipFor(user.personId, compId, "captain");
  if (!membership?.teamId) return null;

  return {
    kind: "team",
    compId: membership.compId,
    compName: membership.compName,
    personId: user.personId,
    personName: membership.personName,
    teamId: membership.teamId,
  };
};

export const resolveLiaisonActor = async (
  token: string,
  compId: string,
): Promise<LiaisonActor | null> => {
  const user = await resolveSessionUser(token);
  if (!user) return null;

  const membership = await membershipFor(user.personId, compId, "liaison");
  if (!membership) return null;

  return {
    kind: "liaison",
    compId: membership.compId,
    compName: membership.compName,
    personId: user.personId,
    personName: membership.personName,
  };
};

export type InvitationView = {
  email: string | null;
  compName: string;
  role: AccountRole;
  teamName: string | null;
  invitedByName: string | null;
};

/**
 * What the accept screen may say about an invitation before anybody has proved anything.
 *
 * The projection is the scope, as it is for `publicComp`: it carries the address the invitation was
 * sent to, the comp, the role and who sent it — enough for the holder to recognize it as theirs, and
 * nothing about the comp's roster, its money, or anybody else on it.
 *
 * **Null for expired, spent, revoked and never-existed alike.** One answer, for the reason a `draft`
 * comp 404s exactly as a nonexistent one does: whether a dead link was ever real is the only thing
 * its holder could learn here, and it is not theirs to learn.
 */
export const describeInvitation = async (token: string): Promise<InvitationView | null> => {
  const inviter = alias(people, "inviter");

  const [row] = await db
    .select({
      email: people.email,
      compName: comps.name,
      role: invitations.role,
      teamName: teams.name,
      invitedByName: inviter.name,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
    })
    .from(invitations)
    .innerJoin(people, eq(people.id, invitations.personId))
    .innerJoin(comps, eq(comps.id, invitations.compId))
    .leftJoin(teams, eq(teams.id, invitations.teamId))
    .leftJoin(inviter, eq(inviter.id, invitations.createdByPersonId))
    .where(and(eq(invitations.tokenHash, hashToken(token)), eq(invitations.purpose, "invite")))
    .limit(1);

  if (!row || !row.role || !isLive(row, now())) return null;

  return {
    email: row.email,
    compName: row.compName,
    role: row.role,
    teamName: row.teamName,
    invitedByName: row.invitedByName,
  };
};

export type Invited = { token: string; invitationId: string };

/**
 * The minting path ADR-0011 refused and ADR-0016 authorizes.
 *
 * It creates the `person` if the email is new to the org, because the alternative is a board being
 * told to go add somebody in one screen before inviting them in another — and `findOrCreatePeople`
 * already established that people are found rather than re-inserted (`people_org_email_unique`
 * refuses the second insert, and every reseed runs through that path).
 *
 * Re-inviting somebody is not an error and does not stack: `invitations_live_unique` is partial over
 * the unspent rows, so the previous envelope is revoked here and the index refuses a second one if
 * two board members click at the same moment.
 */
/**
 * The org a comp belongs to. A `BoardActor` carries a `compId` and not an `orgId`, because until now
 * nothing above the comp was writable — and people are org-scoped, so inviting one needs it.
 */
export const orgOfComp = async (compId: string): Promise<string | null> => {
  const [row] = await db
    .select({ orgId: comps.orgId })
    .from(comps)
    .where(eq(comps.id, compId))
    .limit(1);
  return row?.orgId ?? null;
};

export type InvitedPerson = {
  personId: string;
  name: string;
  email: string | null;
  role: AccountRole;
  teamName: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
};

/**
 * Who has been invited to this comp and where each stands. Comp-scoped off the actor, resolving no
 * id — `registrationWindowFor`'s shape, not a window.
 */
export const listInvitationsForBoard = async (actor: {
  compId: string;
}): Promise<InvitedPerson[]> =>
  db
    .select({
      personId: invitations.personId,
      name: people.name,
      email: people.email,
      role: invitations.role,
      teamName: teams.name,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .innerJoin(people, eq(people.id, invitations.personId))
    .leftJoin(teams, eq(teams.id, invitations.teamId))
    .where(and(eq(invitations.compId, actor.compId), eq(invitations.purpose, "invite")))
    .orderBy(invitations.createdAt) as Promise<InvitedPerson[]>;

export const invite = async (
  actor: { compId: string; personId: string; orgId: string },
  input: { email: string; name: string; role: AccountRole; teamId?: string | null },
): Promise<AccountResult<Invited>> => {
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) return { ok: false, message: "That does not look like an email address." };
  if (!input.name.trim()) return { ok: false, message: "An invitation needs a name to address." };
  if ((input.role === "captain") !== (input.teamId != null)) {
    return {
      ok: false,
      message: "A captain is invited to a team, and nobody else is.",
    };
  }

  const [existing] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.orgId, actor.orgId), eq(people.email, email)))
    .limit(1);

  const [person] = existing
    ? [existing]
    : await db
        .insert(people)
        .values({ orgId: actor.orgId, name: input.name.trim(), email })
        .returning({ id: people.id });

  if (!person) return { ok: false, message: "Could not create that person. Nothing was saved." };

  const at = now();
  const { token, tokenHash } = createToken();

  try {
    // Supersede rather than stack: an unspent envelope for the same person, comp and role is
    // revoked, and the partial index refuses a second live one if two board members race.
    await db
      .update(invitations)
      .set({ revokedAt: at })
      .where(
        and(
          eq(invitations.compId, actor.compId),
          eq(invitations.personId, person.id),
          eq(invitations.role, input.role),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );

    const [row] = await db
      .insert(invitations)
      .values({
        orgId: actor.orgId,
        compId: actor.compId,
        personId: person.id,
        purpose: "invite",
        role: input.role,
        teamId: input.teamId ?? null,
        tokenHash,
        expiresAt: inviteExpiry(at),
        createdByPersonId: actor.personId,
      })
      .returning({ id: invitations.id });

    if (!row) return { ok: false, message: "Could not create that invitation." };

    await recordAudit({
      compId: actor.compId,
      actorKind: "board",
      actorPersonId: actor.personId,
      action: "invitation.create",
      entity: "person",
      entityId: person.id,
      before: null,
      after: { email, role: input.role, teamId: input.teamId ?? null },
    });

    return { ok: true, value: { token, invitationId: row.id } };
  } catch (error) {
    if (violatedConstraint(error) === ACCOUNT_CONSTRAINTS.inviteLive) {
      return {
        ok: false,
        message: "Somebody else just invited that person. They have one invitation, not two.",
      };
    }
    return { ok: false, message: "Could not create that invitation. Nothing was saved." };
  }
};

/**
 * Accepting an invitation: the account, the membership and the session, in one act.
 *
 * **This is a fourth `withTransaction` caller and ADR-0012 asks for the argument to be made rather
 * than inherited.** The invariant is *an invitation is spent exactly when the authority it grants
 * exists*, and it genuinely spans statements: mark the invitation accepted, create or update the
 * user, grant the membership. Every broken half is a state a human has to find — an invitation
 * marked spent that granted nothing, so the person is locked out and their envelope is dead; or a
 * membership with no account behind it, which is authority attached to nobody.
 *
 * The session is created *outside* the transaction on purpose: it is not part of the invariant, and
 * a failure to hand out a cookie is a person clicking "sign in", not a broken grant.
 */
export const acceptInvitation = async (
  token: string,
  password: string,
  userAgent: string | null,
): Promise<AccountResult<SignedIn>> => {
  const strength = checkPassword(password);
  if (!strength.ok) return { ok: false, message: strength.message };

  const [row] = await db
    .select({
      id: invitations.id,
      orgId: invitations.orgId,
      compId: invitations.compId,
      personId: invitations.personId,
      role: invitations.role,
      teamId: invitations.teamId,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
      email: people.email,
    })
    .from(invitations)
    .innerJoin(people, eq(people.id, invitations.personId))
    .where(and(eq(invitations.tokenHash, hashToken(token)), eq(invitations.purpose, "invite")))
    .limit(1);

  if (!row || !isLive(row, now())) {
    return {
      ok: false,
      message: "That invitation has expired or has already been used. Ask for a new one.",
    };
  }
  if (!row.email || !row.compId || !row.role) {
    return { ok: false, message: "That invitation is incomplete. Ask for a new one." };
  }

  const at = now();
  const passwordHash = await hashPassword(password);
  const email = row.email;
  const compId = row.compId;
  const role = row.role;

  const userId = await withTransaction(async (tx) => {
    const spent = await tx
      .update(invitations)
      .set({ acceptedAt: at })
      .where(and(eq(invitations.id, row.id), isNull(invitations.acceptedAt)))
      .returning({ id: invitations.id });

    // The guarded update is the serialization point: a loser spends nothing and grants nothing.
    if (spent.length === 0) return null;

    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, row.orgId), eq(users.email, email)))
      .limit(1);

    const id = existing
      ? existing.id
      : ((
          await tx
            .insert(users)
            .values({
              orgId: row.orgId,
              personId: row.personId,
              email,
              passwordHash,
              emailVerifiedAt: at,
            })
            .returning({ id: users.id })
        )[0]?.id ?? null);

    if (!id) return null;

    // An existing account keeps its password: accepting a second invitation must not be a way to
    // reset somebody else's credentials by knowing their email.
    if (existing) {
      await tx.update(users).set({ emailVerifiedAt: at }).where(eq(users.id, id));
    }

    await tx
      .insert(memberships)
      .values({ compId, personId: row.personId, role, teamId: row.teamId ?? null })
      .onConflictDoNothing();

    await recordAudit(
      {
        compId,
        actorKind: role === "board" ? "board" : role === "captain" ? "team" : "liaison",
        actorPersonId: row.personId,
        action: "invitation.accept",
        entity: "person",
        entityId: row.personId,
        before: null,
        after: { role, teamId: row.teamId ?? null },
      },
      tx,
    );

    return id;
  });

  if (!userId) {
    return { ok: false, message: "That invitation has already been used. Ask for a new one." };
  }

  const { token: sessionToken, tokenHash } = createToken();
  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt: sessionExpiry(at),
    userAgent,
  });

  return { ok: true, value: { token: sessionToken, userId, personId: row.personId } };
};
