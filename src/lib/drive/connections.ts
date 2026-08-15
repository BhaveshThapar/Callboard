import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { driveConnections } from "@/db/schema";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor } from "@/lib/auth/scope";
import { googleConfig, refreshAccessToken } from "./google";
import { seal, unseal } from "./sealed";

/**
 * The org's Google connection: stored, read back for one call, and killable.
 *
 * **`DriveConnectionView` is the projection, and it is the enforcement.** It carries who connected
 * and when, and *not* the sealed token — so a page cannot leak what it never receives, the same way
 * a judge's projection of a team cannot leak a name. The token is only ever read inside
 * `accessTokenFor`, which hands back a short-lived access token and never the refresh token itself.
 */
export type DriveConnectionView = {
  id: string;
  googleEmail: string;
  connectedAt: Date;
};

/** 32 bytes, like every other token this product mints. Lives in a cookie, never in the database. */
export const newOAuthState = (): string => randomBytes(32).toString("base64url");

export const liveConnectionFor = async (orgId: string): Promise<DriveConnectionView | null> => {
  const [row] = await db
    .select({
      id: driveConnections.id,
      googleEmail: driveConnections.googleEmail,
      connectedAt: driveConnections.createdAt,
    })
    .from(driveConnections)
    .where(and(eq(driveConnections.orgId, orgId), isNull(driveConnections.revokedAt)))
    .limit(1);

  return row ?? null;
};

/**
 * Stores a grant, superseding whatever the org had.
 *
 * Revoke-then-insert rather than upsert, because the two rows mean different things and the old one
 * is a record of which account a roster was imported from. `drive_connections_live_unique` is
 * partial over the unspent rows, so the database refuses two live connections even if this code
 * forgets to revoke first — which is `invitations_live_unique`'s arrangement exactly.
 *
 * Not a `withTransaction` caller: a revoke that lands without its insert leaves an org with no
 * connection, which is a state it can leave by connecting again. Nothing is owed and no money moves,
 * so this is not an invariant spanning statements — it is two writes that happen to be adjacent, and
 * ADR-0012 asks for that distinction to be made out loud.
 */
export const storeConnection = async (
  actor: BoardActor,
  orgId: string,
  grant: { refreshToken: string; googleEmail: string; scope: string },
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const sealed = seal(grant.refreshToken);
  if (!sealed.ok) return { ok: false, message: sealed.reason };

  await db
    .update(driveConnections)
    .set({ revokedAt: new Date() })
    .where(and(eq(driveConnections.orgId, orgId), isNull(driveConnections.revokedAt)));

  await db.insert(driveConnections).values({
    orgId,
    googleEmail: grant.googleEmail,
    refreshTokenSealed: sealed.sealed,
    grantedScope: grant.scope,
    connectedByPersonId: actor.personId,
  });

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "drive.connected",
    entity: "org",
    entityId: orgId,
    // The address, never the token. An audit row is read by people.
    after: { googleEmail: grant.googleEmail, scope: grant.scope },
  });

  return { ok: true };
};

export const revokeConnection = async (
  actor: BoardActor,
  orgId: string,
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const live = await liveConnectionFor(orgId);
  if (!live) return { ok: false, message: "There is no Google account connected." };

  await db
    .update(driveConnections)
    .set({ revokedAt: new Date() })
    .where(eq(driveConnections.id, live.id));

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "drive.revoked",
    entity: "org",
    entityId: orgId,
    before: { googleEmail: live.googleEmail },
  });

  return { ok: true };
};

/**
 * A short-lived access token for one call.
 *
 * This is the **only** reader of `refresh_token_sealed`, and it deliberately returns an access token
 * rather than the refresh token, so no caller upstream can hold the long-lived credential or log it.
 * A connection whose seal will not open is reported as needing reconnection rather than throwing:
 * that is what a rotated `DRIVE_TOKEN_KEY` looks like from here, and it is a sentence a board can act
 * on.
 */
export const accessTokenFor = async (
  orgId: string,
): Promise<{ ok: true; accessToken: string } | { ok: false; message: string }> => {
  const config = googleConfig();
  if (!config) return { ok: false, message: "Google Drive is not configured on this deployment." };

  const [row] = await db
    .select({ sealed: driveConnections.refreshTokenSealed })
    .from(driveConnections)
    .where(and(eq(driveConnections.orgId, orgId), isNull(driveConnections.revokedAt)))
    .limit(1);

  if (!row) return { ok: false, message: "Connect a Google account first." };

  const opened = unseal(row.sealed);
  if (!opened.ok) return { ok: false, message: opened.reason };

  const refreshed = await refreshAccessToken(config, opened.value);
  if (!refreshed.ok) return { ok: false, message: refreshed.reason };

  return { ok: true, accessToken: refreshed.value };
};
