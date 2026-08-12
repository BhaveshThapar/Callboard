/**
 * The database half of "who do we write to about this team" — the lookup, not the rule. The rule is
 * `./contact`, and it is pure so it can be tested without one of these.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { memberships } from "@/db/schema";

/**
 * `teamId → personId` for every live captain at this comp.
 *
 * Comp-scoped off the caller's own `compId`, which is what the link resolved to — the same scope
 * `regenerateCharges` and `setCompStatus` take, and for the same reason: the subject is the actor's
 * own comp rather than a row in it, so there is no id on a form here to check.
 *
 * A revoked membership is excluded, so removing a captain stops them being written to on the very
 * next send — the same property that makes revocation mean something at sign-in.
 */
export const captainsByTeam = async (compId: string): Promise<Map<string, string>> => {
  const rows = await db
    .select({ teamId: memberships.teamId, personId: memberships.personId })
    .from(memberships)
    .where(
      and(
        eq(memberships.compId, compId),
        eq(memberships.role, "captain"),
        isNull(memberships.revokedAt),
      ),
    );

  return new Map(rows.flatMap((row) => (row.teamId ? [[row.teamId, row.personId] as const] : [])));
};
