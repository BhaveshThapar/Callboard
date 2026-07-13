import { neon, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
}

/**
 * The default. One HTTP round trip per statement, no session, and therefore **no transactions** --
 * which is not a limitation to route around but the fact the locking design is built on. The
 * `tab_runs` chain indexes exist because `lockResults` cannot be atomic here, and they are a
 * stronger guarantee than a transaction would have been: the database refuses a forked chain even
 * for code that forgets to ask for one.
 */
export const db = drizzle(neon(connectionString), { schema });

export type Transaction = Parameters<Parameters<NeonDatabase<typeof schema>["transaction"]>[0]>[0];

/**
 * The exception, for a write whose invariant spans more than one statement (ADR-0012).
 *
 * A pool per call, torn down in a `finally`. That costs a WebSocket handshake, which is why this is
 * not the default and must not become one: it is for writes that would otherwise leave behind a
 * half-state a human has to find -- a waitlist promotion that moves a slot and a balance together,
 * and very little else. Reads and single-statement writes stay on `db`.
 *
 * Per call rather than a module-level singleton because this runs in serverless functions that are
 * frozen and thawed between invocations, and a pool held across that boundary hands out sockets the
 * platform has already closed underneath it.
 */
export const withTransaction = async <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => {
  const pool = new Pool({ connectionString });
  try {
    return await drizzlePool(pool, { schema }).transaction(fn);
  } finally {
    await pool.end();
  }
};

export { schema };
