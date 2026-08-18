import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `./index` reads DATABASE_URL when it loads.
const { db } = await import("./index");
const { sql } = await import("drizzle-orm");

/**
 * Creates the non-owner role P3's policies actually apply to, and prints the connection string.
 *
 * **This is not a migration, and that is deliberate.** It needs a password, which does not belong in
 * a file committed to a repository, and it is one act per deployment rather than one act per schema
 * version. The policies themselves are in `0020` and apply to `PUBLIC`, so they are role-agnostic.
 *
 * **`NOBYPASSRLS` is the whole point.** `neondb_owner` has `rolbypassrls = true`, and so does
 * `neon_superuser` — which every role created through Neon's console or API inherits. A role made
 * the obvious way carries the policies correctly and denies nothing: the purest form of this repo's
 * recurring defect, and one that passes every test written against it. Raw SQL and an explicit
 * refusal is what avoids it, and `db:doctor` checks the flag rather than trusting this script ran.
 */
const password = process.argv[2];
if (!password) {
  console.error(
    [
      "",
      "✗ Usage: bun run db:rls-role <password>",
      "",
      "  Creates `callboard_app`, the non-owner role row-level security applies to, and grants it",
      "  the reads and writes the product needs. Generate a password with:",
      "",
      "    openssl rand -base64 24",
      "",
      "  Then set the connection string it prints as DATABASE_URL_APP on the deployment. Until that",
      "  is set the app connects as the owner and behaves exactly as before — RLS is defence in",
      "  depth here, not the thing holding tenancy up.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const ROLE = "callboard_app";

/**
 * A `DO $$ … $$` block cannot take bind parameters — its body is an opaque string to the parser, so
 * passing the password as `$1` fails with *bind message supplies 5 parameters, but prepared
 * statement "" requires 0*. So the literal is escaped and inlined, which is safe here for a reason
 * worth stating rather than assuming: this is a CLI, the value comes from the operator's own argv,
 * and it never touches a request. Nothing in `src/` builds SQL this way.
 */
const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const [existing] = (
  await db.execute<{ n: number }>(
    sql`select count(*)::int as n from pg_roles where rolname = ${ROLE}`,
  )
).rows;

await db.execute(
  sql.raw(
    existing && existing.n > 0
      ? `alter role ${ROLE} with login nobypassrls password ${literal(password)}`
      : `create role ${ROLE} with login nobypassrls password ${literal(password)}`,
  ),
);

// Reads and writes on what exists now, plus a default for what a later migration adds — otherwise
// the next table silently denies everything to the app and nothing says why.
await db.execute(sql`grant usage on schema public to ${sql.raw(ROLE)}`);
await db.execute(
  sql`grant select, insert, update, delete on all tables in schema public to ${sql.raw(ROLE)}`,
);
await db.execute(sql`grant usage, select on all sequences in schema public to ${sql.raw(ROLE)}`);
await db.execute(
  sql`alter default privileges in schema public grant select, insert, update, delete on tables to ${sql.raw(ROLE)}`,
);
await db.execute(
  sql`alter default privileges in schema public grant usage, select on sequences to ${sql.raw(ROLE)}`,
);

const [row] = (
  await db.execute<{ bypass: boolean }>(
    sql`select rolbypassrls as bypass from pg_roles where rolname = ${ROLE}`,
  )
).rows;

if (row?.bypass !== false) {
  console.error(
    `\n✗ ${ROLE} exists but has BYPASSRLS. Every policy would attach correctly and deny nothing.\n`,
  );
  process.exit(1);
}

const owner = process.env.DATABASE_URL ?? "";
const appUrl = owner.replace(/\/\/[^:]+:[^@]+@/, `//${ROLE}:${encodeURIComponent(password)}@`);

console.log(
  [
    "",
    `✓ ${ROLE} created without BYPASSRLS, and granted read/write on every table.`,
    "",
    "  Set this as DATABASE_URL_APP on the deployment:",
    "",
    `  ${appUrl}`,
    "",
    "  db:doctor reports which connection the app is using. Until this is set, the app connects as",
    "  the owner and row-level security applies to nothing.",
    "",
  ].join("\n"),
);
