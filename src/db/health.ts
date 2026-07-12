/**
 * The verdict on whether a seeded demo is one a prospect can be shown. Pure and DB-free so it
 * unit-tests without DATABASE_URL; `doctor.ts` gathers the `Observed` facts and applies it.
 */

export type DemoHealth =
  | { ok: true; board: string; judges: number; teams: number }
  | { ok: false; problems: string[] };

export type Observed = {
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
  /** Comps that have board links but not one that still opens. */
  boardlessComps: { compId: string; revoked: number }[];
};

const RESEED = "reseed with 'bun run db:seed'";

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
 * A comp every one of whose board links has been revoked. Nobody can lock it, correct it, or
 * download its results, and nothing in the product can give it a link back.
 *
 * `revokeBoardAction` cannot produce this — it refuses to revoke the second-to-last link, in the
 * same statement that does the write. But that guarantee lives in an application statement, not in
 * the schema the way `tab_runs_root_unique` does, so it binds that one code path and nothing else: a
 * hand-run UPDATE is not bound by it. That is exactly why the state is worth detecting rather than
 * assuming away, and it is the same reasoning that puts the chain indexes above.
 *
 * Like those, this is a fact about the database rather than about the demo comp, so it outlives the
 * "comp not seeded" short-circuit. And like those, reseeding is not the remedy: `db:seed` deletes
 * the org and cascades to the comp's scores, so offering it here would answer "your board is locked
 * out" with "destroy the results".
 */
const boardlessProblems = (observed: Observed): string[] =>
  observed.boardlessComps.map(
    ({ compId, revoked }) =>
      `comp ${compId} has ${revoked} board link(s) and not one of them still opens: nobody can ` +
      "lock, correct, or download its results. The board screen cannot produce this, so a link was " +
      "revoked outside the product. A board link must be minted against the existing comp — " +
      "reseeding would delete its scores.",
  );

export const summarizeHealth = (
  observed: Observed,
  expected: { judges: number; teams: number },
): DemoHealth => {
  const databaseProblems = [...chainProblems(observed), ...boardlessProblems(observed)];

  if (!observed.compFound) {
    return {
      ok: false,
      problems: [...databaseProblems, "comp not seeded — run 'bun run db:seed'"],
    };
  }

  const problems: string[] = databaseProblems;

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
