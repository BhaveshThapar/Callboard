import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `@/db` reads DATABASE_URL when it loads.
const { db } = await import("@/db");
const { boardAssignments, tabRuns } = await import("@/db/schema");
const { eq, sql } = await import("drizzle-orm");
const { lockResults } = await import("@/lib/comp/tab");

/**
 * Breaks a database in the exact three ways `db:doctor` claims to detect, so that the claim can be
 * checked. The doctor's *verdict* function is pure and thoroughly unit-tested; the half that reads
 * the database — the `pg_indexes` lookup, the fork `GROUP BY`, the board join — has only ever been
 * run against a healthy one. A wrong index name or a broken grouping would pass every unit test.
 *
 * Nothing here is reachable from the product, and nothing should be. `e2e/guard.ts` refuses the
 * deployed demo's compute outright, which is what makes this safe to point at `dev` and `ci`.
 */
const [command, argument] = process.argv.slice(2);
if (!command) throw new Error("usage: break-db.ts <command> [argument]");

const need = (name: string): string => {
  if (!argument) throw new Error(`${name} requires an argument`);
  return argument;
};

switch (command) {
  /**
   * The index's own definition, straight from Postgres. Captured before dropping and replayed to
   * restore, so the DDL is never written down a second time -- `CHAIN_INDEXES` is the one place the
   * schema, the lock path and the doctor agree on these, and a test must not become a fourth.
   */
  case "index-def": {
    const result = await db.execute<{ def: string }>(
      sql`select pg_get_indexdef(c.oid) as def from pg_class c where c.relname = ${need("index-def")}`,
    );
    const def = result.rows[0]?.def;
    if (!def) throw new Error(`no such index: ${argument}`);
    console.log(def);
    break;
  }

  case "drop-index": {
    await db.execute(sql.raw(`drop index if exists ${need("drop-index")}`));
    console.log("dropped");
    break;
  }

  case "restore-index": {
    // The argument is a definition pg itself produced, replayed verbatim.
    await db.execute(sql.raw(need("restore-index")));
    console.log("restored");
    break;
  }

  /** A first lock, with whatever scores exist -- enough to give the comp a root run. */
  case "lock": {
    const run = await lockResults(need("lock"));
    console.log(run.id);
    break;
  }

  /**
   * A second root: the fork the chain indexes exist to refuse. Only representable while
   * `tab_runs_root_unique` is dropped, which is why the spec must drop it first -- and is exactly
   * why a database that never got migration 0006 is the only place a real one could be found.
   */
  case "fork": {
    const compId = need("fork");
    const [root] = await db
      .select()
      .from(tabRuns)
      .where(eq(tabRuns.compId, compId))
      .limit(1);
    if (!root) throw new Error("comp has no run to fork");

    await db.insert(tabRuns).values({
      compId: root.compId,
      rubricId: root.rubricId,
      inputs: root.inputs,
      config: root.config,
      results: root.results,
      supersedesId: null,
    });
    console.log("forked");
    break;
  }

  /**
   * Clears every run for the comp. The repair after a fork -- and it must happen *before* the index
   * goes back on, because a unique index cannot be created over rows that already violate it.
   */
  case "unfork": {
    await db.delete(tabRuns).where(eq(tabRuns.compId, need("unfork")));
    console.log("cleared");
    break;
  }

  case "unboard": {
    await db.delete(boardAssignments).where(eq(boardAssignments.compId, need("unboard")));
    console.log("unboarded");
    break;
  }

  default:
    throw new Error(`unknown command: ${command}`);
}
