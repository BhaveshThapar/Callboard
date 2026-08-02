import { eq, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";

/**
 * Marks a person as no longer wanting broadcast mail. Idempotent: a second click is not an error,
 * and the timestamp records the first one, which is the one somebody would be asked to produce.
 */
export const unsubscribe = async (personId: string): Promise<boolean> => {
  // A malformed id is a 200 with "nothing to unsubscribe" rather than a 500 -- this URL arrives from
  // a mail client, and mail clients mangle URLs.
  if (!/^[0-9a-f-]{36}$/i.test(personId)) return false;

  const [row] = await db
    .update(people)
    .set({ unsubscribedAt: new Date() })
    .where(and(eq(people.id, personId), isNull(people.unsubscribedAt)))
    .returning({ id: people.id });

  if (row) return true;

  const [already] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  return already !== undefined;
};
