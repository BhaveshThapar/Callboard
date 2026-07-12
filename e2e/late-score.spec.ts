import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * A correction replays the locked snapshot. It does not re-read the world.
 *
 * `lockResults` used to rebuild `TabulationInput` from the live tables on *every* call, overrides
 * included — so anything written between the lock and the correction silently entered the corrected
 * result. Nothing in the audit trail could show it: each run reproduces from its own frozen row, so
 * run 1 and run 2 both verify while describing different worlds.
 *
 * The board's own "no deduction — re-tabulate only" correction is the case that names the bug. It
 * is supposed to be a no-op. This drives exactly that: a full set of inverted scores lands after
 * the lock, the board corrects with no deduction, and the placements must not move by a hair.
 *
 * The scores are written straight to the table rather than through the judge's form, because the
 * form refuses to write after a lock. That guard is a check-then-write over a driver with no
 * transactions, so a judge submitting as the lock lands still gets a row in — and this is that row,
 * produced on demand instead of by winning a race.
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

const writeLateScoresFor = (judgeToken: string): number =>
  Number(
    execFileSync("bunx", ["tsx", "e2e/support/late-score.ts", "--judge-token", judgeToken], {
      encoding: "utf8",
    }).trim(),
  );

test("a score that lands after the lock enters no run, and the board is told", async ({
  browser,
}) => {
  const demo = seed();
  const scoringJudge = demo.judges[0]!;
  const lateJudge = demo.judges[1]!;

  const judgeContext = await browser.newContext();
  const judgePage = await judgeContext.newPage();
  await judgePage.goto(`/judge/${scoringJudge.token}`);

  const cards = judgePage.locator('form[data-testid^="team-card-"]');
  await expect(cards).toHaveCount(TEAM_COUNT);

  // Descending in team index: the first team wins by a wide margin.
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

  const board = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const boardPage = await board.newPage();
  await boardPage.goto(`/board/${demo.boardToken}`);

  await boardPage.getByTestId("lock-button").click();
  await expect(boardPage.getByRole("heading", { name: "Final placements" })).toBeVisible();
  await expect(boardPage.getByText("Run 1, locked at")).toBeVisible();

  const standings = boardPage.getByTestId("standings");
  const placementsAtRun1 = await standings.locator("tr").allInnerTexts();
  expect(placementsAtRun1.length).toBeGreaterThan(0);

  // The race, made deterministic: a whole judge's scores land after the lock, inverted.
  const written = writeLateScoresFor(lateJudge.token);
  expect(written).toBe(TEAM_COUNT * CRITERIA.length);

  // The board is told, rather than left to discover it in the placements.
  await boardPage.reload();
  const banner = boardPage.getByTestId("scores-outside-chain");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(`${written} scores arrived after the lock`);

  // Run 1 still reproduces: the late scores did not touch it.
  await expect(boardPage.getByTestId("verification")).toHaveAttribute("data-reproduces", "true");

  // "No deduction — re-tabulate only". The correction that is supposed to change nothing.
  await boardPage
    .getByLabel("Reason for the correction")
    .fill("Re-tabulating to confirm the result stands.");
  await expect(boardPage.getByLabel("Team to deduct from")).toHaveValue("");
  await boardPage.getByTestId("override-button").click();

  await expect(boardPage.getByText("Run 2 supersedes run 1.")).toBeVisible();
  await expect(boardPage.getByText("Run 2, locked at")).toBeVisible();

  // The whole point. Before the fix, run 2 rebuilt its inputs from the live tables, swallowed the
  // inverted scores, and reordered the podium under a reason that said it was changing nothing.
  await expect
    .poll(async () => standings.locator("tr").allInnerTexts())
    .toEqual(placementsAtRun1);

  // And run 2 is a real, frozen, reproducible run in its own right — not a copy of run 1's row.
  await expect(boardPage.getByTestId("verification")).toHaveAttribute("data-reproduces", "true");
  await expect(boardPage.getByText("a correction of the run before it")).toBeVisible();

  // Still uncounted, and still said out loud, after the correction that did not pick them up.
  await expect(boardPage.getByTestId("scores-outside-chain")).toBeVisible();

  await board.close();
});
