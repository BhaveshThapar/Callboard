import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { CHAIN_INDEXES } from "../src/db/schema/scores";

/**
 * `db:doctor` is the preflight before a prospect call, so the thing it must never do is pass a
 * database it should have failed.
 *
 * Its verdict function (`summarizeHealth`) is pure and every failure branch is unit-tested against
 * a fabricated `Observed`. What those tests cannot reach is the half that *produces* `Observed`
 * from a real database: the `pg_indexes` lookup, the forked-comp `GROUP BY ... HAVING`, the board
 * join. A wrong index name or a broken grouping would leave all eleven of them green while the
 * doctor cheerfully passed a database that can still fork a locked result.
 *
 * So each failure branch is driven here against a database actually in that state. Two of the three
 * states are only representable while the chain indexes are dropped, so this drops them -- and puts
 * them back from the definition Postgres itself hands over, in a `finally`, because leaving the
 * `dev` branch without them would be a worse bug than the one being tested for.
 */

const run = (...args: string[]): string =>
  execFileSync("bunx", ["tsx", ...args], { encoding: "utf8" });

/** Reseeds, and hands back the comp the doctor is about to be pointed at. */
const seed = (): { compId: string } => {
  const file = join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), "demo.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--json", file], { stdio: "pipe" });
  return JSON.parse(readFileSync(file, "utf8")) as { compId: string };
};

/** The doctor's own CLI, as a board member runs it: stdout and exit code, never a thrown stack. */
const doctor = (): { ok: boolean; output: string } => {
  try {
    return { ok: true, output: run("src/db/doctor-cli.ts") };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
};

test("db:doctor passes on a freshly seeded demo", () => {
  seed();

  const health = doctor();
  expect(health.ok).toBe(true);
  expect(health.output).toContain("healthy");
});

test("db:doctor fails a database whose chain indexes are missing, and does not offer to reseed", () => {
  seed();

  const name = CHAIN_INDEXES.root;
  const definition = run("e2e/support/break-db.ts", "index-def", name).trim();
  expect(definition).toContain(name);

  try {
    run("e2e/support/break-db.ts", "drop-index", name);

    const health = doctor();
    expect(health.ok).toBe(false);
    expect(health.output).toContain("can still fork");
    expect(health.output).toContain("db:migrate");

    // Reseeding does not create an index. Offering it would be the preflight lying about its own
    // repair -- the demo would come back "healthy" with the guarantee still absent.
    expect(health.output).not.toContain("db:seed");
  } finally {
    run("e2e/support/break-db.ts", "restore-index", definition);
  }

  expect(doctor().ok).toBe(true);
});

test("db:doctor names a comp that has already forked, and refuses to reseed it away", () => {
  const comp = seed();

  const name = CHAIN_INDEXES.root;
  const definition = run("e2e/support/break-db.ts", "index-def", name).trim();

  try {
    run("e2e/support/break-db.ts", "drop-index", name);
    run("e2e/support/break-db.ts", "lock", comp.compId);
    run("e2e/support/break-db.ts", "fork", comp.compId);

    const health = doctor();
    expect(health.ok).toBe(false);
    expect(health.output).toContain(comp.compId);
    expect(health.output).toContain("2 locked-result chains, not one");
    expect(health.output).toContain("human must decide");

    // Which of two locked results stood is not a question a seed script gets to answer.
    expect(health.output).not.toContain("db:seed");
  } finally {
    // The fork has to go before the index comes back: a unique index cannot be created over rows
    // that already violate it. Reseeding is not the repair here either -- and could not be, since
    // the seeder verifies its own work with this same doctor and refuses a database missing them.
    run("e2e/support/break-db.ts", "unfork", comp.compId);
    run("e2e/support/break-db.ts", "restore-index", definition);
  }

  expect(doctor().ok).toBe(true);
});

test("db:doctor fails a comp with no board link", () => {
  const comp = seed();

  run("e2e/support/break-db.ts", "unboard", comp.compId);

  const health = doctor();
  expect(health.ok).toBe(false);
  expect(health.output).toContain("no board link");

  // Here reseeding *is* the remedy, and the doctor is allowed to say so.
  expect(health.output).toContain("db:seed");

  seed();
  expect(doctor().ok).toBe(true);
});
