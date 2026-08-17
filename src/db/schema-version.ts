import { sql } from "drizzle-orm";
import { migrationsExpected } from "./journal";
import { db } from "./index";

export type SchemaVersion = {
  /**
   * Migrations this database has applied, or null when the `drizzle` schema is absent — skipped,
   * not guessed, the same rule the money queries follow when their tables are missing.
   */
  migrationsApplied: number | null;
  /** Migrations the repo carries: `drizzle/meta/_journal.json`, which is the one definition. */
  migrationsExpected: number;
};

/**
 * How far behind the repo this database is.
 *
 * `drizzle.__drizzle_migrations` lives in the `drizzle` schema, not `public` — every other catalog
 * query in `doctor.ts` filters on `schemaname = 'public'` and would miss it. A database that has
 * never run drizzle-kit has no such table, and `to_regclass` returns null rather than throwing, which
 * is what keeps a preflight reporting where a bare `select` would crash.
 *
 * Separated from `doctor.ts` so `/api/health` can ask this one question without importing
 * `boardSnapshot`, `judgeSnapshot` and `listJudgeLabelsForBoard` along with it. That is not
 * cosmetic: those reach for the request boundary, and the health route must stay the two integers and
 * five booleans it advertises.
 */
export const observeSchemaVersion = async (): Promise<SchemaVersion> => {
  const result = await db.execute<{ applied: number | null }>(sql`
    select case
             when to_regclass('drizzle.__drizzle_migrations') is null then null
             else (select count(*)::int from drizzle.__drizzle_migrations)
           end as applied
  `);

  // `?? null` rather than `|| null`: a database with the table and zero rows has applied 0, which
  // is the most behind it is possible to be and must not read as "cannot tell".
  return { migrationsApplied: result.rows[0]?.applied ?? null, migrationsExpected };
};
