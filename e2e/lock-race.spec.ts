import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * A comp's runs are one chain: one root, one head. The lock is the moment everyone is crowded
 * around the same laptop, so two people submitting it at once is the ordinary accident, not the
 * exotic one.
 *
 * `lockResults` checks for a previous run before it inserts, but neon-http has no transactions, so
 * the check and the insert are two acts and a second submission can land between them. Both reads
 * return "not locked yet", both insert with a null `supersedes_id`, and the comp ends up with two
 * unsuperseded roots: two frozen, attributed, reproducible results, each of which would pass an
 * audit on its own, with nothing to say which one stands. `latestLockedRun` picks by `seq` and
 * shows one as if the other were not there.
 *
 * `tab_runs_root_unique` is what makes that impossible, and this is the witness. Whether the race
 * is won by the application's pre-check or by the database's constraint is a timing detail; the
 * board must see the same thing either way, which is what is asserted here.
 */

type SeededDemo = {
  compName: string;
  boardName: string;
  boardToken: string;
  judges: { name: string; token: string }[];
};

const CRITERIA = [
  { label: "Choreography", maxPoints: 30 },
  { label: "Execution", maxPoints: 30 },
  { label: "Musicality", maxPoints: 20 },
  { label: "Stage Presence", maxPoints: 20 },
];

const TEAM_COUNT = 8;

const seed = (): SeededDemo => {
  const file = join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), "demo.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--json", file], { stdio: "pipe" });
  return JSON.parse(readFileSync(file, "utf8")) as SeededDemo;
};

test("two board members locking at once produce one run, not two roots", async ({ browser }) => {
  const demo = seed();
  const judge = demo.judges[0]!;

  const judgeContext = await browser.newContext();
  const judgePage = await judgeContext.newPage();
  await judgePage.goto(`/judge/${judge.token}`);

  const cards = judgePage.locator('form[data-testid^="team-card-"]');
  await expect(cards).toHaveCount(TEAM_COUNT);

  for (let teamIndex = 0; teamIndex < TEAM_COUNT; teamIndex++) {
    const card = cards.nth(teamIndex);
    for (const criterion of CRITERIA) {
      await card
        .getByLabel(criterion.label, { exact: true })
        .fill(String(Math.max(0, criterion.maxPoints - teamIndex * 2)));
    }
    await card.getByRole("button", { name: /Submit|Update/ }).click();
    await expect(card.getByText("Scored")).toBeVisible();
  }
  await judgeContext.close();

  // Two board windows on the same comp, both showing an unlocked board, neither aware of the other.
  const viewport = { width: 1280, height: 900 };
  const [first, second] = await Promise.all([
    browser.newContext({ viewport }),
    browser.newContext({ viewport }),
  ]);
  const [pageA, pageB] = await Promise.all([first.newPage(), second.newPage()]);

  await Promise.all([
    pageA.goto(`/board/${demo.boardToken}`),
    pageB.goto(`/board/${demo.boardToken}`),
  ]);
  await expect(pageA.getByTestId("lock-button")).toBeVisible();
  await expect(pageB.getByTestId("lock-button")).toBeVisible();

  await Promise.all([
    pageA.getByTestId("lock-button").click(),
    pageB.getByTestId("lock-button").click(),
  ]);

  // Whichever board member lost is told a person got there first — never shown the SQL that
  // Postgres refused. Drizzle's own message is the failed INSERT, so this is checked here, while
  // the action's error is still on screen and before any reload clears it.
  for (const page of [pageA, pageB]) {
    await expect(page.getByRole("heading", { name: "Final placements" })).toBeVisible();
    await expect(
      page.getByText(/Failed query|duplicate key|violates unique constraint/i),
    ).toHaveCount(0);
  }

  // One lock happened, so the trail records one. It is server-rendered rather than polled — the
  // banner above arrives on the 2s poll, the trail only on a reload — so this reloads until the
  // write lands. Two roots would make it two.
  await expect
    .poll(async () => {
      await pageA.reload();
      return pageA.getByText("tab.lock").count();
    }, { timeout: 20_000 })
    .toBe(1);

  // `lockedRunNumber` counts the comp's runs. Two roots would read "Run 2" while claiming to
  // correct nothing — the exact tell, and the reason this asserts the number and not just the lock.
  for (const page of [pageA, pageB]) {
    await page.reload();
    await expect(page.getByText("Run 1, locked at")).toBeVisible();
    await expect(page.getByText("a correction of the run before it")).toHaveCount(0);
    await expect(page.getByTestId("verification")).toHaveAttribute("data-reproduces", "true");
  }

  await Promise.all([first.close(), second.close()]);
});
