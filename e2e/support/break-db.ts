import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `@/db` reads DATABASE_URL when it loads.
const { db } = await import("@/db");
const { boardAssignments, charges, depositEvents, paymentAllocations, payments, tabRuns, teams } =
  await import("@/db/schema");
const { and, eq, isNotNull, isNull, sql } = await import("drizzle-orm");
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

  /**
   * A CHECK constraint's own definition, straight from Postgres, with the table it sits on.
   * `pg_get_indexdef` carries its table inside the DDL; `pg_get_constraintdef` does not, so the
   * table is carried alongside. Same discipline as `index-def`: the DDL is captured rather than
   * written down again, so `MONEY_CONSTRAINTS` stays the one place it is named.
   */
  case "constraint-def": {
    const result = await db.execute<{ tbl: string; def: string }>(
      sql`select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def
            from pg_constraint where conname = ${need("constraint-def")}`,
    );
    const row = result.rows[0];
    if (!row) throw new Error(`no such constraint: ${argument}`);
    console.log(`${row.tbl}|${argument}|${row.def}`);
    break;
  }

  case "drop-constraint": {
    const [table, name] = need("drop-constraint").split("|");
    await db.execute(sql.raw(`alter table ${table} drop constraint if exists ${name}`));
    console.log("dropped");
    break;
  }

  case "restore-constraint": {
    const [table, name, def] = need("restore-constraint").split("|");
    await db.execute(sql.raw(`alter table ${table} add constraint ${name} ${def}`));
    console.log("restored");
    break;
  }

  /**
   * A payment whose counter claims money is spoken for that no allocation accounts for -- ADR-0014's
   * named residual, reached the way it would actually be reached: a write that moved the counter and
   * never inserted the row, or a hand-typed allocation that skipped the counter.
   *
   * No constraint is broken to do this, and that is the point. `payments_allocated_check` permits it
   * (216000 <= 216000); the database enforces `allocated <= gross`, not `allocated = sum(...)`. The
   * amount is NCSU's $2,160 lump, which is the shape this whole table exists for.
   */
  case "drift-payment": {
    const compId = need("drift-payment");
    const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.compId, compId)).limit(1);
    if (!team) throw new Error(`comp ${compId} has no teams`);
    const [row] = await db
      .insert(payments)
      .values({
        compId,
        teamId: team.id,
        rail: "venmo",
        grossCents: 216000,
        feeCents: 0,
        netCents: 216000,
        allocatedCents: 216000,
      })
      .returning({ id: payments.id });
    console.log(row.id);
    break;
  }

  case "undrift": {
    await db.delete(payments).where(eq(payments.compId, need("undrift")));
    console.log("cleared");
    break;
  }

  /**
   * Voids a charge while leaving its allocation live — the state the product no longer produces,
   * because `syncCharges` and `voidChargesFor` release first, but which rows written before that
   * are still sitting in.
   *
   * Again no constraint is broken, and again that is the point: the counter still equals the sum of
   * the payment's live allocations, so `db:doctor`'s drift query reports nothing. What has gone is
   * the obligation underneath, which that query never joins to.
   */
  case "orphan-allocation": {
    const compId = need("orphan-allocation");
    const [row] = await db
      .select({ chargeId: paymentAllocations.chargeId, paymentId: paymentAllocations.paymentId })
      .from(paymentAllocations)
      .innerJoin(charges, eq(charges.id, paymentAllocations.chargeId))
      .where(and(eq(charges.compId, compId), isNull(paymentAllocations.voidedAt)))
      .limit(1);
    if (!row) throw new Error(`comp ${compId} has no live allocations to orphan`);

    await db.update(charges).set({ voidedAt: new Date() }).where(eq(charges.id, row.chargeId));
    console.log(`${row.paymentId} ${row.chargeId}`);
    break;
  }

  /**
   * Money marked as returned with no ending to account for it — ADR-0015's named residual, and
   * `drift-payment`'s shape one column over. `payments_refunded_check` permits it (10000 <= 10000):
   * the database can constrain `refunded_cents` against the payment's own gross and cannot make it
   * agree with the deposit chain, because that agreement spans tables.
   */
  case "unexplained-refund": {
    const compId = need("unexplained-refund");
    const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.compId, compId)).limit(1);
    if (!team) throw new Error(`comp ${compId} has no teams`);
    const [row] = await db
      .insert(payments)
      .values({
        compId,
        teamId: team.id,
        rail: "venmo",
        grossCents: 10000,
        feeCents: 0,
        netCents: 10000,
        allocatedCents: 0,
        refundedCents: 10000,
      })
      .returning({ id: payments.id });
    console.log(row.id);
    break;
  }

  /**
   * A deposit that ended twice — `fork-comp` for a smaller chain. Reachable only with the terminal
   * index out of the way, exactly as a forked run chain is, which is why the spec drops it first and
   * restores it after clearing the rows: an index cannot be built over rows that violate it.
   */
  case "fork-deposit": {
    const compId = need("fork-deposit");
    const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.compId, compId)).limit(1);
    if (!team) throw new Error(`comp ${compId} has no teams`);
    await db.insert(depositEvents).values([
      { compId, teamId: team.id, state: "refunded", reason: "e2e" },
      { compId, teamId: team.id, state: "forfeited", reason: "e2e" },
    ]);
    console.log(team.id);
    break;
  }

  case "unfork-deposit": {
    await db.delete(depositEvents).where(eq(depositEvents.compId, need("unfork-deposit")));
    console.log("cleared");
    break;
  }

  /**
   * Drops a column a *later* migration added, leaving the table it lives on in place.
   *
   * The state the doctor crashed on rather than reported: `deposit_events` arrives in `0010` and its
   * `team_id` in `0011`, so a database at `0010` passes the table guard and then throws
   * `column "team_id" does not exist` out of the fork query. `CASCADE` takes the dependent index and
   * foreign key with it, which is exactly the shape a database that never ran `0011` is in.
   */
  case "drop-team-id": {
    await db.execute(sql.raw(`alter table deposit_events drop column team_id cascade`));
    console.log("dropped");
    break;
  }

  /**
   * Puts it back by replaying migration `0011` itself, filtered to the statements that mention the
   * column. The DDL has one definition and it is the migration -- `index-def`'s discipline, applied
   * to a column: a fixture that wrote `ADD COLUMN ... uuid NOT NULL REFERENCES ...` by hand would be
   * a second definition, and the first time the two disagreed this test would restore the wrong
   * schema and pass anyway.
   */
  case "restore-team-id": {
    const { readFileSync, readdirSync } = await import("node:fs");
    const file = readdirSync("drizzle").find((name) => name.startsWith("0011_"));
    if (!file) throw new Error("migration 0011 is missing from drizzle/");

    const statements = readFileSync(`drizzle/${file}`, "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim().replace(/;$/, ""))
      .filter((statement) => statement.includes("team_id"));
    if (statements.length === 0) throw new Error("no team_id statements found in 0011");

    for (const statement of statements) await db.execute(sql.raw(statement));
    console.log(`restored:${statements.length}`);
    break;
  }

  case "unorphan": {
    // Restore rather than delete: the demo has to be left exactly as it was found.
    await db
      .update(charges)
      .set({ voidedAt: null })
      .where(and(eq(charges.compId, need("unorphan")), isNotNull(charges.voidedAt)));
    console.log("cleared");
    break;
  }

  /**
   * The newest applied migration, captured before it is removed so it can be put back verbatim.
   * Same discipline as `index-def`: the row is never written down a second time, because
   * `drizzle/meta/_journal.json` is the one definition of what this database ought to have.
   */
  case "migration-def": {
    const result = await db.execute<{ hash: string; created_at: string }>(
      sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    );
    const row = result.rows[0];
    if (!row) throw new Error("this database has applied no migrations");
    console.log(`${row.hash}|${row.created_at}`);
    break;
  }

  /**
   * Rewinds the migration *record* by one without touching the schema it describes.
   *
   * That is deliberately not the same thing as un-applying a migration, and it is the sharper test:
   * the columns stay, so every other check the doctor runs still passes, and the only thing wrong is
   * that the database says it is behind the repo. A check that only fired once a column went missing
   * would be the check that already existed.
   */
  case "drop-migration": {
    await db.execute(
      sql`delete from drizzle.__drizzle_migrations
           where created_at = (select max(created_at) from drizzle.__drizzle_migrations)`,
    );
    console.log("rewound");
    break;
  }

  case "restore-migration": {
    const [hash, createdAt] = need("restore-migration").split("|");
    await db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at)
          values (${hash}, ${Number(createdAt)})`,
    );
    console.log("restored");
    break;
  }

  default:
    throw new Error(`unknown command: ${command}`);
}
