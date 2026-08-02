/**
 * The verdict on whether a seeded demo is one a prospect can be shown. Pure and DB-free so it
 * unit-tests without DATABASE_URL; `doctor.ts` gathers the `Observed` facts and applies it.
 */

export type DemoHealth =
  | { ok: true; board: string; judges: number; teams: number }
  | { ok: false; problems: string[] };

export type Observed = {
  /**
   * Migrations this database has applied, or null when the `drizzle` schema is absent — skipped,
   * not guessed, the same rule the money queries follow when their tables are missing.
   */
  migrationsApplied: number | null;
  /** Migrations the repo carries: `drizzle/meta/_journal.json`, which is the one definition. */
  migrationsExpected: number;
  compFound: boolean;
  boardAssignments: number;
  boardName: string | null;
  boardViewLoaded: boolean;
  judges: number;
  judgeViewLoaded: boolean;
  /** Distinct `Judge N` labels the board's de-identified projection resolves. */
  judgeLabels: number;
  teams: number;
  /** Both partial unique indexes on `tab_runs` exist: the chain cannot fork. */
  forkGuaranteeEnforced: boolean;
  /** Comps whose run chain does not have exactly one root. Only ever non-empty above. */
  forkedComps: { compId: string; roots: number }[];
  /** Every constraint in `MONEY_CONSTRAINTS` exists: an over-allocation is unrepresentable. */
  moneyGuaranteeEnforced: boolean;
  /**
   * Payments whose `allocated_cents` disagrees with the sum of their live allocations — ADR-0014's
   * named residual. The database enforces `allocated <= gross`, not `allocated = sum(...)`, so this
   * is the half that has to be *found* rather than refused.
   */
  driftingPayments: { paymentId: string; allocatedCents: number; allocatedSum: number }[];
  /**
   * Live allocations pointing at a charge that has been voided — money recorded against an
   * obligation that no longer exists. The counter and the live allocations still agree, so the
   * drift check above is blind to it by construction.
   */
  orphanedAllocations: { paymentId: string; chargeId: string; amountCents: number }[];
};

const RESEED = "reseed with 'bun run db:seed'";

/**
 * Whether this database has the schema the code in front of it expects.
 *
 * The other two database-level checks are *constraint-shaped*: they ask whether a specific
 * guarantee is enforceable, and each names the migration that adds it. That is stronger than a
 * version number where it applies — and it is blind wherever a migration adds no constraint.
 *
 * Migrations `0007` and `0008` are pure `ADD COLUMN`. They carry no index and no CHECK, so nothing
 * below could see them missing, and on July 13 2026 the first of them broke every page that reads
 * `comps.registration` on the deployed demo. That outage ran nineteen days. The money check would
 * have caught it on July 31, when `0009` landed — eighteen days late — and only because the money
 * spine happened to add constraints.
 *
 * So this is the generic backstop, deliberately weaker and deliberately broader: it does not know
 * what is missing, only that the database is behind the repo. Counting rather than comparing hashes
 * is on purpose — a hash comparison would also flag a migration edited after it was applied, which
 * is a different failure with no evidence of ever happening here, and a preflight that cries wolf
 * is a preflight that gets skipped before a call.
 *
 * Reseeding is not offered, for the reason the other two do not offer it: a seed does not apply a
 * migration, and `db:seed` runs this very check afterwards and would refuse to print links anyway.
 */
const schemaProblems = (observed: Observed): string[] => {
  if (observed.migrationsApplied === null) return [];
  if (observed.migrationsApplied >= observed.migrationsExpected) return [];

  const behind = observed.migrationsExpected - observed.migrationsApplied;
  return [
    `this database is ${behind} migration${behind === 1 ? "" : "s"} behind the repo ` +
      `(${observed.migrationsApplied} applied, ${observed.migrationsExpected} in drizzle/). ` +
      "The code deployed in front of it expects columns and tables it does not have — apply them " +
      "with 'bun run db:migrate'.",
  ];
};

/**
 * Whether the database can still fork a comp's run chain, and whether one already has.
 *
 * These are facts about the *database*, not about the demo comp, so they outlive the "comp not
 * seeded" short-circuit below: a demo nobody has seeded yet on a database missing the indexes is
 * still a database missing the indexes, and reseeding will not add them.
 *
 * The two are one question. Once `tab_runs_root_unique` exists a second root is unrepresentable, so
 * a forked comp can only be found on a database that never got the migration — which makes this the
 * preflight for applying it. A comp with no runs at all yields nothing here: an unlocked demo is
 * healthy, not forked.
 */
const chainProblems = (observed: Observed): string[] => {
  const problems: string[] = [];

  if (!observed.forkGuaranteeEnforced) {
    problems.push(
      "a comp's locked results can still fork: the tab_runs chain indexes are missing. " +
        "This database predates migration 0006 — apply it with 'bun run db:migrate'.",
    );
  }

  for (const { compId, roots } of observed.forkedComps) {
    problems.push(
      `comp ${compId} has ${roots} locked-result chains, not one. A human must decide which ` +
        "result stood — migration 0006 cannot be applied until one does.",
    );
  }

  return problems;
};

/**
 * Whether the money tables can still hold a state a treasurer cannot act on, and whether one
 * already does.
 *
 * The same two-part shape as `chainProblems`, and for the same reason. `MONEY_CONSTRAINTS` makes
 * over-allocation, a broken `net = gross - fee`, a duplicate obligation and a replayed payment all
 * *unrepresentable* — but only on a database that actually carries them, and the code may not
 * assume it is the database the code intended.
 *
 * The drift check is the half no constraint can do. ADR-0014 accepted a named residual: the CHECK
 * constrains the counter, not the sum it stands for, so anything writing an allocation without
 * moving the counter creates a disagreement. Refusing it is impossible; finding it is not, and a
 * disagreement someone is shown is the whole difference between this and a number that is silently
 * wrong. Reseeding fixes neither, and is not offered for either.
 */
const moneyProblems = (observed: Observed): string[] => {
  const problems: string[] = [];

  if (!observed.moneyGuaranteeEnforced) {
    problems.push(
      "a payment can still be allocated past what was paid: the money constraints are missing. " +
        "This database predates migration 0009 — apply it with 'bun run db:migrate'.",
    );
  }

  for (const { paymentId, allocatedCents, allocatedSum } of observed.driftingPayments) {
    problems.push(
      `payment ${paymentId} says ${allocatedCents} cents are allocated but its live allocations ` +
        `sum to ${allocatedSum}. Something wrote an allocation without moving the counter; a human ` +
        "must decide which figure is true before the balance it feeds can be trusted.",
    );
  }

  // The second detectable bad state of the same family, and the one the drift check structurally
  // cannot see: the counter and the live allocations agree perfectly, it is the charge underneath
  // that has gone. Voiding a charge now releases its allocations, so this can only be a row written
  // before that did — which is exactly why the doctor has to look rather than assume.
  for (const { paymentId, chargeId, amountCents } of observed.orphanedAllocations) {
    problems.push(
      `payment ${paymentId} still has ${amountCents} cents allocated to charge ${chargeId}, which ` +
        "has been voided. The money is recorded against an obligation that no longer exists; a " +
        "human must release it so it reads as unattached credit.",
    );
  }

  return problems;
};

export const summarizeHealth = (
  observed: Observed,
  expected: { judges: number; teams: number },
): DemoHealth => {
  if (!observed.compFound) {
    return {
      ok: false,
      problems: [
        ...schemaProblems(observed),
        ...chainProblems(observed),
        ...moneyProblems(observed),
        "comp not seeded — run 'bun run db:seed'",
      ],
    };
  }

  const problems: string[] = [
    ...schemaProblems(observed),
    ...chainProblems(observed),
    ...moneyProblems(observed),
  ];

  if (observed.boardAssignments === 0) {
    problems.push(`no board link for the demo comp — ${RESEED}`);
  } else if (!observed.boardViewLoaded) {
    problems.push(`board view failed to load — ${RESEED}`);
  }

  if (observed.judges < expected.judges) {
    problems.push(`only ${observed.judges} of ${expected.judges} judges resolve — ${RESEED}`);
  } else if (!observed.judgeViewLoaded) {
    problems.push(`judge view failed to load — ${RESEED}`);
  }

  // A judge with no label has no de-identified name for the board's export to use. Every board
  // surface that carries a score takes the label, so this is the demo failing closed rather than
  // falling back to a name -- but it fails closed mid-call, which is what the preflight is for.
  if (observed.judgeLabels < expected.judges) {
    problems.push(
      `only ${observed.judgeLabels} of ${expected.judges} judges have a Judge N label — ${RESEED}`,
    );
  }

  if (observed.teams < expected.teams) {
    problems.push(`only ${observed.teams} of ${expected.teams} teams seeded — ${RESEED}`);
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    board: observed.boardName ?? "",
    judges: observed.judges,
    teams: observed.teams,
  };
};
