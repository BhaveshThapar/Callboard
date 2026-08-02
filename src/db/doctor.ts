import journal from "../../drizzle/meta/_journal.json";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import type { BoardActor, JudgeActor } from "@/lib/auth/scope";
import { listJudgeLabelsForBoard } from "@/lib/auth/scope";
import { boardSnapshot } from "@/lib/comp/board";
import { judgeSnapshot } from "@/lib/comp/judge";
import type { CompConfig } from "./config";
import { summarizeHealth } from "./health";
import type { DemoHealth, Observed } from "./health";
import { db } from "./index";
import {
  boardAssignments,
  CHAIN_INDEX_NAMES,
  comps,
  MONEY_CONSTRAINT_NAMES,
  judgeAssignments,
  orgs,
  people,
  tabRuns,
  teams,
} from "./schema";

type ChainObservation = Pick<Observed, "forkGuaranteeEnforced" | "forkedComps">;

type MoneyObservation = Pick<
  Observed,
  | "moneyGuaranteeEnforced"
  | "driftingPayments"
  | "orphanedAllocations"
  | "forkedDeposits"
  | "unexplainedRefunds"
>;

type SchemaObservation = Pick<Observed, "migrationsApplied" | "migrationsExpected">;

/**
 * The tables the money spine needs. `deposit_events` arrives in `0010` rather than `0009` and was
 * missing from this list for a day — so a database with the ledger and no deposit chain passed every
 * check here, and the two queries below had nothing to run against and silently did not run.
 */
const MONEY_TABLES = [
  "fee_schedules",
  "charges",
  "payments",
  "payment_allocations",
  "deposit_events",
] as const;

/**
 * How far behind the repo this database is.
 *
 * `drizzle.__drizzle_migrations` lives in the `drizzle` schema, not `public` — every other catalog
 * query here filters on `schemaname = 'public'` and would miss it. A database that has never run
 * drizzle-kit has no such table, and `to_regclass` returns null rather than throwing, which is what
 * keeps a preflight reporting where a bare `select` would crash.
 *
 * The expected count is `drizzle/meta/_journal.json`, imported rather than written down, for the
 * reason `CHAIN_INDEXES` and `MONEY_CONSTRAINTS` have one definition each: a number typed here would
 * be a second one, and it would be wrong the first time somebody generated a migration.
 */
const observeSchema = async (): Promise<SchemaObservation> => {
  const migrationsExpected = journal.entries.length;

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

/**
 * Whether over-allocation is still representable on this database, and whether a counter has
 * already drifted from the allocations it stands for.
 *
 * A fact about the database rather than the demo, like `observeChain`, and gathered the same way.
 * `MONEY_CONSTRAINTS` spans two catalogs — three are partial unique indexes (`pg_indexes`) and two
 * are CHECK constraints (`pg_constraint`) — so both are read and unioned. Neither has a drizzle
 * model, so both are raw SQL.
 *
 * The drift query is the half ADR-0014 could not push into the database. It is skipped, not
 * guessed, when the tables are absent: a database without `payments` has no drift, and selecting
 * from a missing table would throw where a preflight must report.
 */
const observeMoney = async (): Promise<MoneyObservation> => {
  const [present, tables, columns] = await Promise.all([
    db.execute<{ name: string }>(sql`
      select indexname as name from pg_indexes where schemaname = 'public'
      union
      select conname as name from pg_constraint
    `),
    db.execute<{ tablename: string }>(sql`
      select tablename from pg_tables where schemaname = 'public'
    `),
    /**
     * **A table existing is not the column existing, and this preflight crashed over the
     * difference.** `deposit_events` arrives in `0010` and its `team_id` in `0011`, so a database at
     * `0010` passed the table guard above and then threw `column "team_id" does not exist` out of
     * the fork query — turning the instrument that exists to *report* a database behind the repo
     * into one that dies on it. Found by pointing it at the deployed demo, which is the only place
     * it could have been found, because every other database here is migrated by the tooling that
     * generates the migration.
     */
    db.execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
       where table_schema = 'public'
    `),
  ]);

  const names = new Set(present.rows.map((row) => row.name));
  const moneyGuaranteeEnforced = MONEY_CONSTRAINT_NAMES.every((name) => names.has(name));

  const existing = new Set(tables.rows.map((row) => row.tablename));
  const hasColumn = (table: string, column: string): boolean =>
    columns.rows.some((row) => row.table_name === table && row.column_name === column);

  if (!MONEY_TABLES.every((table) => existing.has(table))) {
    return {
      moneyGuaranteeEnforced,
      driftingPayments: [],
      orphanedAllocations: [],
      forkedDeposits: [],
      unexplainedRefunds: [],
    };
  }

  // `coalesce`, because a payment with no live allocations should read 0 rather than drop out of
  // the comparison -- a counter claiming $2,160 is spent against nothing is exactly the drift.
  const drifting = await db.execute<{
    payment_id: string;
    allocated_cents: number;
    allocated_sum: number;
  }>(sql`
    select p.id as payment_id,
           p.allocated_cents,
           coalesce(sum(a.amount_cents) filter (where a.voided_at is null), 0)::int as allocated_sum
      from payments p
      left join payment_allocations a on a.payment_id = p.id
     group by p.id, p.allocated_cents
    having p.allocated_cents
         <> coalesce(sum(a.amount_cents) filter (where a.voided_at is null), 0)
  `);

  // A live allocation against a dead charge. Invisible to the query above, which compares the
  // counter to the live allocations and finds them agreeing -- what has gone is the obligation
  // underneath, which that comparison never joins to.
  const orphaned = await db.execute<{
    payment_id: string;
    charge_id: string;
    amount_cents: number;
  }>(sql`
    select a.payment_id, a.charge_id, a.amount_cents
      from payment_allocations a
      join charges c on c.id = a.charge_id
     where a.voided_at is null
       and c.voided_at is not null
  `);

  /**
   * A deposit that ended twice — `tab_runs`' forked chain, one table over.
   *
   * `deposit_events_terminal_unique` makes this unrepresentable, exactly as the chain indexes do for
   * a locked result, and for the same reason the doctor cannot assume it is there: the guarantee
   * lives in the database, so the code has to look. Rows written before `0011` are the realistic
   * source, because the index was keyed on `charge_id` until then and a void-and-reinsert let a
   * second ending through against a fresh id.
   */
  const forkedDeposits = hasColumn("deposit_events", "team_id")
    ? await db.execute<{ team_id: string; endings: number }>(sql`
        select team_id, count(*)::int as endings
          from deposit_events
         where state in ('refunded', 'forfeited')
         group by comp_id, team_id
        having count(*) > 1
      `)
    : { rows: [] };

  /**
   * Money marked as returned with no ending to explain it.
   *
   * `refunded_cents` is the second denormalized number in the schema, and it earns the same
   * treatment as the first: the CHECK constrains it against `gross_cents` but nothing can make it
   * agree with the deposit chain, because that spans tables. A refund is the only act that moves it,
   * so a payment carrying one for a team whose deposit never ended is a number nobody can account
   * for — and an unaccountable number in a ledger is the $5,000 gap in miniature.
   */
  const unexplained =
    hasColumn("payments", "refunded_cents") && hasColumn("deposit_events", "team_id")
      ? await db.execute<{ payment_id: string; refunded_cents: number }>(sql`
          select p.id as payment_id, p.refunded_cents
            from payments p
           where p.refunded_cents > 0
             and not exists (
                   select 1 from deposit_events e
                    where e.team_id = p.team_id
                      and e.comp_id = p.comp_id
                      and e.state = 'refunded'
                 )
        `)
      : { rows: [] };

  return {
    moneyGuaranteeEnforced,
    driftingPayments: drifting.rows.map((row) => ({
      paymentId: row.payment_id,
      allocatedCents: row.allocated_cents,
      allocatedSum: row.allocated_sum,
    })),
    orphanedAllocations: orphaned.rows.map((row) => ({
      paymentId: row.payment_id,
      chargeId: row.charge_id,
      amountCents: row.amount_cents,
    })),
    forkedDeposits: forkedDeposits.rows.map((row) => ({
      teamId: row.team_id,
      endings: row.endings,
    })),
    unexplainedRefunds: unexplained.rows.map((row) => ({
      paymentId: row.payment_id,
      refundedCents: row.refunded_cents,
    })),
  };
};

/**
 * Whether a comp's locked results can still fork on this database, and whether one already has.
 *
 * Unlike everything else here this is a fact about the database, not about the seeded demo, so it is
 * gathered before the comp is even looked for. It is also the one check reseeding cannot fix.
 *
 * `pg_indexes` is a catalog table and has no drizzle model, so it is reachable only as raw SQL. The
 * indexes' *presence* is the guarantee: `lockResults` checks for a previous run before it inserts,
 * but neon-http has no transactions, so that check and that insert are two acts and two board
 * members can land between them. Postgres is the only thing that can actually refuse the fork, and
 * a database missing these indexes silently does not.
 *
 * The two halves are one question. With the indexes in place a second root is unrepresentable, so a
 * forked comp can only ever be found on a database that never got migration 0006 — which makes this
 * the preflight for applying it. A comp that has never been locked has no runs, groups to nothing,
 * and is correctly not flagged.
 */
const observeChain = async (): Promise<ChainObservation> => {
  const [indexes, forked] = await Promise.all([
    db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where tablename = 'tab_runs'`,
    ),
    db
      .select({ compId: tabRuns.compId, roots: count() })
      .from(tabRuns)
      .where(isNull(tabRuns.supersedesId))
      .groupBy(tabRuns.compId)
      .having(gt(count(), 1)),
  ]);

  const present = new Set(indexes.rows.map((row) => row.indexname));

  return {
    forkGuaranteeEnforced: CHAIN_INDEX_NAMES.every((name) => present.has(name)),
    forkedComps: forked,
  };
};

/**
 * Is the seeded demo one a prospect can actually be shown? A comp seeded under an older schema can
 * carry a dead board link while the judge links still resolve -- the failure surfaces only when the
 * board link is opened, mid-call. So this checks the properties that break -- a board link resolves,
 * the board view renders, the guarantees are enforceable -- rather than trusting a version number.
 *
 * It also counts migrations now, and that is not a retreat from the above. Property checks are only
 * as broad as the properties somebody thought to name: `0007` adds a nullable column, breaks no
 * guarantee, and took the deployed demo down for nineteen days in July 2026 while every check here
 * passed. The count is the backstop for the migration nobody wrote a check for.
 *
 * It only reads, so it is safe against `main` -- which is the database it most needs to be run
 * against, and was not.
 */
export const checkDemoHealth = async (config: CompConfig): Promise<DemoHealth> => {
  const [schema, chain, money, [comp]] = await Promise.all([
    observeSchema(),
    observeChain(),
    observeMoney(),
    db
      .select({ id: comps.id, name: comps.name })
      .from(comps)
      .innerJoin(orgs, eq(orgs.id, comps.orgId))
      .where(and(eq(orgs.slug, config.org.slug), eq(comps.slug, config.comp.slug)))
      .limit(1),
  ]);

  if (!comp) {
    return summarizeHealth(
      {
        ...schema,
        ...chain,
        ...money,
        compFound: false,
        boardAssignments: 0,
        boardName: null,
        boardViewLoaded: false,
        judges: 0,
        judgeViewLoaded: false,
        judgeLabels: 0,
        teams: 0,
      },
      { judges: config.judges.length, teams: config.teams.length },
    );
  }

  // The same join `resolveBoardActor` does, without the token filter: does *any* live board link
  // resolve to a person? Zero rows is the dropped-column footgun.
  const board = await db
    .select({ assignmentId: boardAssignments.id, personId: people.id, personName: people.name })
    .from(boardAssignments)
    .innerJoin(people, eq(people.id, boardAssignments.personId))
    .where(and(eq(boardAssignments.compId, comp.id), isNull(boardAssignments.revokedAt)));

  let boardViewLoaded = false;
  let judgeLabels = 0;
  const first = board[0];
  if (first) {
    const actor: BoardActor = {
      kind: "board",
      compId: comp.id,
      compName: comp.name,
      personId: first.personId,
      personName: first.personName,
      boardAssignmentId: first.assignmentId,
    };
    try {
      await boardSnapshot(actor);
      boardViewLoaded = true;
    } catch {
      boardViewLoaded = false;
    }

    // The projection every board-facing export of a score goes through. It reads `label_seq`, which
    // `boardSnapshot` does not touch — so a comp seeded before that column existed still renders a
    // board view and still fails at the export, which is exactly the drift this preflight is for.
    try {
      const labels = await listJudgeLabelsForBoard(actor);
      judgeLabels = new Set(labels.map((l) => l.label)).size;
    } catch {
      judgeLabels = 0;
    }
  }

  // The judge page assembles its own data (judge_snapshot), including `judge_notes` that the board
  // never reads — the same drift class as the dropped board column, on a table the board check misses.
  // The join mirrors `resolveJudgeActor` without the token filter, and doubles as the judge count.
  const judges = await db
    .select({ assignmentId: judgeAssignments.id, personId: people.id, personName: people.name })
    .from(judgeAssignments)
    .innerJoin(people, eq(people.id, judgeAssignments.personId))
    .where(and(eq(judgeAssignments.compId, comp.id), isNull(judgeAssignments.revokedAt)));

  let judgeViewLoaded = false;
  const firstJudge = judges[0];
  if (firstJudge) {
    const actor: JudgeActor = {
      kind: "judge",
      compId: comp.id,
      compName: comp.name,
      personId: firstJudge.personId,
      judgeName: firstJudge.personName,
      judgeAssignmentId: firstJudge.assignmentId,
    };
    try {
      await judgeSnapshot(actor);
      judgeViewLoaded = true;
    } catch {
      judgeViewLoaded = false;
    }
  }

  const roster = await db.select({ id: teams.id }).from(teams).where(eq(teams.compId, comp.id));

  return summarizeHealth(
    {
      ...schema,
      ...chain,
      ...money,
      compFound: true,
      boardAssignments: board.length,
      boardName: first?.personName ?? null,
      boardViewLoaded,
      judges: judges.length,
      judgeViewLoaded,
      judgeLabels,
      teams: roster.length,
    },
    { judges: config.judges.length, teams: config.teams.length },
  );
};
