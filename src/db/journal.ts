import journal from "../../drizzle/meta/_journal.json";

/**
 * How many migrations the repo carries.
 *
 * Its own file so that a caller with no `DATABASE_URL` can have the number: `./index` throws at load
 * when the variable is unset, and `db:migration-check` runs in CI where there is deliberately no
 * database credential at all. Importing the journal from `doctor.ts` would drag that throw along.
 *
 * Imported rather than written down, for `CHAIN_INDEXES`' reason: a number typed here would be a
 * second definition, and it would be wrong the first time somebody generated a migration.
 */
export const migrationsExpected = journal.entries.length;
