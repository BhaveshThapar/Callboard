import { desc, eq } from "drizzle-orm";
import type { Transaction } from "@/db";
import { db } from "@/db";
import { auditLog, people } from "@/db/schema";
import type { ActorKind } from "@/db/schema";

export type AuditEntry = {
  compId: string;
  actorKind: ActorKind;
  actorPersonId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

/**
 * `on` is the writer, defaulting to the pooled connection. A write that happens inside a
 * transaction has to log inside the same one: an audit row that commits while the change it
 * describes rolls back is worse than no audit row, because it is a record of something that did
 * not happen.
 */
export const recordAudit = async (entry: AuditEntry, on: Transaction | typeof db = db) => {
  await on.insert(auditLog).values({
    compId: entry.compId,
    actorKind: entry.actorKind,
    actorPersonId: entry.actorPersonId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
};

/** `actorName` is null only for `system` writes, which have no person behind them. */
export const recentAudit = (compId: string, limit = 50) =>
  db
    .select({
      id: auditLog.id,
      actorKind: auditLog.actorKind,
      actorName: people.name,
      action: auditLog.action,
      entity: auditLog.entity,
      at: auditLog.at,
    })
    .from(auditLog)
    .leftJoin(people, eq(people.id, auditLog.actorPersonId))
    .where(eq(auditLog.compId, compId))
    .orderBy(desc(auditLog.at))
    .limit(limit);
