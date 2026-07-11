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
  teams: number;
};

const RESEED = "reseed with 'bun run db:seed'";

export const summarizeHealth = (
  observed: Observed,
  expected: { judges: number; teams: number },
): DemoHealth => {
  if (!observed.compFound) {
    return { ok: false, problems: ["comp not seeded — run 'bun run db:seed'"] };
  }

  const problems: string[] = [];

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
