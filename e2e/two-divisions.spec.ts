import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * A comp is one division (ADR-0010), so a board running two of them gets two comps under one org --
 * and docs/INTAKE.md tells a treasurer to send each division separately. The seed used to delete by
 * org slug, which meant following that instruction destroyed the division seeded before it: its
 * teams, its scores, and the links already on its judges' phones.
 *
 * This is the witness. Restore the org delete in `seedFromConfig` and the first assertion below
 * fails -- division one's board link stops resolving the moment division two is seeded.
 */

type Seeded = {
  compId: string;
  compName: string;
  boardName: string;
  boardToken: string;
  board: { name: string; token: string }[];
  judges: { name: string; token: string }[];
};

const ORG = { name: "Two Division Org", slug: "e2e-two-division-org" };

const RUBRIC = {
  name: "Shared Rubric",
  normalization: "zscore",
  tiebreakers: [{ kind: "head_to_head" }],
  criteria: [
    { label: "Choreography", maxPoints: 30 },
    { label: "Execution", maxPoints: 30 },
  ],
};

// The same two humans sit on both divisions, which is the normal case and the one that exercises
// person reuse: `people` is org-scoped and survives the comp delete, so a second seed must find
// them rather than insert them again into `people_org_email_unique`.
const BOARD = [
  { name: "Tab Chair", email: "tab@example.com" },
  { name: "Comp Director", email: "director@example.com" },
];

const division = (slug: string, name: string, bidCodes: string[]) => ({
  org: ORG,
  comp: { name, slug, status: "live" },
  rubric: RUBRIC,
  teams: bidCodes.map((bidCode, i) => ({ bidCode, name: `${name} Team ${i + 1}` })),
  judges: [{ name: `${name} Judge`, email: `judge-${slug}@example.com` }],
  board: BOARD,
});

const FUSION = division("fusion", "Fusion", ["A-101", "B-202"]);
const CLASSICAL = division("classical", "Classical", ["C-303", "D-404"]);

const seed = (config: object): Seeded => {
  const dir = mkdtempSync(join(tmpdir(), "callboard-e2e-"));
  const configPath = join(dir, "comp.json");
  const outPath = join(dir, "seeded.json");
  writeFileSync(configPath, JSON.stringify(config));
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", configPath, "--json", outPath], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(outPath, "utf8")) as Seeded;
};

test("seeding a second division leaves the first one standing", async ({ page }) => {
  const fusion = seed(FUSION);
  const fusionJudge = fusion.judges[0]!;

  // The links are out: a board member has one, a judge has one on a phone.
  expect((await page.goto(`/board/${fusion.boardToken}`))?.status()).toBe(200);
  expect((await page.goto(`/judge/${fusionJudge.token}`))?.status()).toBe(200);

  const classical = seed(CLASSICAL);

  // Nothing the second seed did may reach the first division. Under the org delete both of these
  // 404 -- the cascade took the assignments and the tokens stopped resolving.
  expect((await page.goto(`/board/${fusion.boardToken}`))?.status()).toBe(200);
  expect((await page.goto(`/judge/${fusionJudge.token}`))?.status()).toBe(200);

  // And its teams are still its own, not replaced by the division seeded after it.
  await page.goto(`/judge/${fusionJudge.token}`);
  await expect(page.getByText("A-101")).toBeVisible();
  await expect(page.getByText("B-202")).toBeVisible();
  await expect(page.getByText("C-303")).toHaveCount(0);

  // The second division is live and independent, with its own board link and its own teams.
  expect((await page.goto(`/board/${classical.boardToken}`))?.status()).toBe(200);
  await page.goto(`/judge/${classical.judges[0]!.token}`);
  await expect(page.getByText("C-303")).toBeVisible();
  await expect(page.getByText("A-101")).toHaveCount(0);

  expect(classical.compId).not.toBe(fusion.compId);
});

test("reseeding a comp replaces that comp and reuses the org's people", async ({ page }) => {
  const first = seed(FUSION);

  // The same config again. `people` survived the comp delete, so this is the path that would trip
  // `people_org_email_unique` if the seed re-inserted the board instead of finding it -- the demo
  // reseed before every call runs straight through here.
  const second = seed(FUSION);

  expect(second.compId).not.toBe(first.compId);
  expect(second.board.map((b) => b.name)).toEqual(BOARD.map((b) => b.name));

  // A reseed is still destructive to the comp it names -- that is what the protected-database guard
  // in seed-cli exists to refuse. The old links stop resolving; the new ones open.
  expect((await page.goto(`/board/${first.boardToken}`))?.status()).toBe(404);
  expect((await page.goto(`/board/${second.boardToken}`))?.status()).toBe(200);
});
