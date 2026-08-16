import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * P3's first act, and it exists because two documents said it had already happened.
 *
 * `ARCHITECTURE.md` and [ADR-0006](../docs/decisions/0006-tenancy-app-layer-scoping-rls-later.md)
 * both stated that a `db.batch` + `SET LOCAL` spike had been run and that it settled the hardest
 * open question under row-level security — whether a serverless HTTP driver can carry per-request
 * session state at all. No such spike is in this repository: `*.local.ts` is gitignored, so whatever
 * was run left nothing behind, and `db.batch` has no callers in `src/`.
 *
 * That is a worse shape than the defect this repo keeps recording. The previous five were *code with
 * no caller*, and a reader could at least see the code. **A claim with no code is findable only by
 * grepping for something that is not there**, which is why it survived two documents and a plan.
 *
 * So the mechanism is established here, as a tracked test CI re-runs, and the documents cite this
 * file rather than a memory. Four probes, and the second is the one that decides whether the whole
 * design is safe.
 *
 * Nothing here writes a row or reads product data. It sets a custom GUC and reads it back, so unlike
 * every other spec in this directory it needs no seed, breaks nothing, and has nothing to repair in
 * a `finally`.
 */

type Probe = { name: string; result: string };
const findings: Probe[] = [];
const record = (name: string, result: string): void => {
  findings.push({ name, result });
};

const PRELUDE = `
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const { db } = await import("../../../src/db/index.ts");
const { sql } = await import("drizzle-orm");
`;

/**
 * Runs a script through `tsx` for `break-db.ts`'s reason: `@/db` reads `DATABASE_URL` at module load,
 * so a probe has to be a subprocess with the environment already resolved.
 *
 * A written file rather than `--eval`, which compiles as CJS and rejects the top-level `await` every
 * probe here needs. That mattered beyond ergonomics: with `--eval`, **P3 passed by catching the
 * compile error instead of a Postgres refusal** — a green test asserting nothing, which is this
 * repo's own recurring defect appearing inside the file written to close an instance of it. Hence
 * the message assertion in P3, which a compile error does not satisfy.
 */
const runAgainstDb = (body: string): string => {
  // Inside the project, and `.mts`. Both are forced rather than stylistic: ESM resolves bare
  // specifiers and `./src/...` relative to the importing *file*, so a probe in the OS temp directory
  // finds neither `dotenv` nor `@/db`; and `.ts` there would compile as CJS, because tsx reads
  // `"type": "module"` from the nearest package.json and there is none. `node_modules/.cache` is
  // already ignored by git, so the scratch file cannot become a tracked artifact.
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".cache", "callboard-rls-"));
  const file = join(dir, "probe.mts");
  writeFileSync(file, `${PRELUDE}\n${body}`);
  return execFileSync("bunx", ["tsx", file], {
    stdio: "pipe",
    encoding: "utf8",
    cwd: process.cwd(),
  }).trim();
};

test.afterAll(() => {
  // The record is the point. A probe whose result is only in a CI log is the problem again.
  console.log("\n  RLS spike findings\n  " + "-".repeat(18));
  for (const { name, result } of findings) console.log(`  ${name}: ${result}`);
  console.log("");
});

test("P1 — db.batch carries set_config and its reader as one transaction", async () => {
  const out = runAgainstDb(`
    const rows = await db.batch([
      db.execute(sql\`select set_config('app.comp_id', 'probe-p1', true) as set\`),
      db.execute(sql\`select current_setting('app.comp_id', true) as got\`),
    ]);
    console.log(JSON.stringify(rows[1].rows[0]));
  `);

  // If this reads back, a scoped read can be prefixed with the actor's comp and the policy will see
  // it. If it does not, RLS on neon-http needs pooled connections and P3 is a different project.
  expect(JSON.parse(out)).toEqual({ got: "probe-p1" });
  record("P1 carries", "yes — the second statement reads what the first set");
});

test("P2 — and it does not leak to the next request on the same pooled endpoint", async () => {
  // The probe that decides safety. `SET LOCAL`/`set_config(_, _, true)` is transaction-scoped, so a
  // value surviving into an unrelated request would mean one comp's scope silently applied to
  // another's read -- an isolation bug produced by the mechanism bought to prevent isolation bugs.
  // Separate processes are deliberately *not* used here: that would prove nothing about pooling.
  const out = runAgainstDb(`
    const batched = await db.batch([
      db.execute(sql\`select set_config('app.comp_id', 'probe-p2', true) as set\`),
      db.execute(sql\`select current_setting('app.comp_id', true) as got\`),
    ]);
    const after = await db.execute(sql\`select current_setting('app.comp_id', true) as got\`);
    console.log(JSON.stringify({ inside: batched[1].rows[0].got, after: after.rows[0].got }));
  `);

  const { inside, after } = JSON.parse(out) as { inside: string | null; after: string | null };

  // Both halves, because either alone passes vacuously: an empty read afterwards proves nothing
  // about isolation if the value was never set in the first place. That is the shape of a test
  // asserting its own no-op, which this file has already produced once today.
  expect(inside).toBe("probe-p2");
  expect(after === null || after === "").toBe(true);
  record("P2 leaks", "no — set inside the batch, empty on the next request to the same endpoint");
});

test("P3 — set_config is the only parameterizable form; SET LOCAL takes no bind", async () => {
  // The trap, and the likely reason the wrong mechanism was written down: Postgres will not bind a
  // parameter into `SET LOCAL`, so a spike run by hand with a literal comp id returns green and the
  // code built from it fails on the first real value. Asserted so the next person cannot repeat it.
  let refused = "";
  try {
    runAgainstDb(`
      await db.execute(sql\`set local app.comp_id = \${"probe-p3"}\`);
      console.log("accepted");
    `);
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }

  expect(refused).not.toBe("");
  expect(refused).toMatch(/syntax error|SET LOCAL|parameter/i);
  record("P3 SET LOCAL $1", "refused by Postgres — set_config(name, value, true) is the form");
});

test("P4 — what prefixing costs a fan-out read, measured and not asserted", async () => {
  // `boardSnapshot` is an 8-way Promise.all and `listRosterForBoard` a 4-way; under RLS each becomes
  // a two-statement batch. The number is *recorded* rather than asserted against a threshold,
  // because a latency bound nobody chose is a flake waiting to happen -- which is the lesson from
  // the wall-clock assertion deleted from this suite a week ago.
  // Nine rounds and the median, because a single pair is mostly noise: the first version of this
  // probe reported 2.87x and 1.04x on consecutive runs of identical code. A number that unstable,
  // quoted once, is worse than no number -- it is the shape of evidence without the substance.
  const out = runAgainstDb(`
    const one = async () => { await db.execute(sql\`select 1 as n\`); };
    const prefixed = async () => {
      await db.batch([
        db.execute(sql\`select set_config('app.comp_id', 'probe-p4', true) as set\`),
        db.execute(sql\`select 1 as n\`),
      ]);
    };
    const time = async (f) => {
      const at = performance.now();
      await Promise.all(Array.from({ length: 8 }, f));
      return performance.now() - at;
    };
    for (const f of [one, prefixed]) await time(f);        // warm the connection, discard
    const bare = [], with_ = [];
    for (let i = 0; i < 9; i++) { bare.push(await time(one)); with_.push(await time(prefixed)); }
    const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    console.log(JSON.stringify({
      bare: median(bare), prefixed: median(with_),
      spread: [Math.min(...with_), Math.max(...with_)],
    }));
  `);

  const { bare, prefixed, spread } = JSON.parse(out) as {
    bare: number;
    prefixed: number;
    spread: [number, number];
  };
  expect(bare).toBeGreaterThan(0);
  expect(prefixed).toBeGreaterThan(0);
  record(
    "P4 fan-out cost",
    `8 parallel reads, median of 9: ${bare.toFixed(0)}ms bare vs ${prefixed.toFixed(0)}ms prefixed ` +
      `(${(prefixed / bare).toFixed(2)}x). Prefixed range ${spread[0].toFixed(0)}-${spread[1].toFixed(0)}ms — ` +
      `run-to-run spread is wide, so treat the ratio as an order of magnitude, not a measurement.`,
  );
});
