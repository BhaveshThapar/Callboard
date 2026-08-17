import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import { retryingFetch } from "./connect";
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
 *
 * One statement per request also means one **DNS resolution** per statement, and a resolution that
 * fails is a 500 on whatever page asked. `retryingFetch` sends those again and only those — see
 * `neverArrived`, which is narrow on purpose.
 *
 * It is set on `neonConfig` rather than passed to `neon()` because the driver exposes it only as
 * process-wide configuration. That is worth knowing rather than hiding: it reaches every `neon()`
 * client in the process, which is what we want and is not what the call site looks like. It does
 * **not** reach `Pool` below — that connects over a WebSocket and never calls `fetch`.
 */
neonConfig.fetchFunction = retryingFetch();

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
 *
 * **`retryingFetch` does not cover this path**, and that is correct rather than an omission: a pool
 * connects over a WebSocket instead of per-statement HTTPS, so it resolves a hostname once per call
 * rather than once per statement, and a failure here aborts a transaction that rolls back whole.
 * Retrying an open transaction is the ambiguity `neverArrived` exists to refuse, not an extension
 * of it.
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
