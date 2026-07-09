import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * PRD §8.3, encoded literally: a board can run scoring for 8 teams and 3 judges,
 * on phones, and produce locked, auditable placements in under ~5 minutes,
 * with results reproducible the next day.
 */

type SeededDemo = {
  compId: string;
  compName: string;
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
const JUDGE_COUNT = 3;
const EXPECTED_SCORES = TEAM_COUNT * JUDGE_COUNT * CRITERIA.length;

/** Strictly decreasing in team index, so placements are unambiguous. Judges differ in strictness. */
const scoreFor = (teamIndex: number, judgeIndex: number, maxPoints: number): number =>
  Math.max(0, maxPoints - teamIndex - judgeIndex);

const seed = (): SeededDemo => {
  const file = join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), "demo.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--json", file], { stdio: "pipe" });
  return JSON.parse(readFileSync(file, "utf8")) as SeededDemo;
};

test("8 teams, 3 judges, phones: locked auditable placements that reproduce", async ({
  browser,
}) => {
  const demo = seed();
  expect(demo.judges).toHaveLength(JUDGE_COUNT);

  const started = Date.now();

  for (const [judgeIndex, judge] of demo.judges.entries()) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/judge/${judge.token}`);

    await expect(page.getByRole("heading", { name: `Scoring — ${judge.name}` })).toBeVisible();

    const cards = page.locator('form[data-testid^="team-card-"]');
    await expect(cards).toHaveCount(TEAM_COUNT);

    // A judge sees bid codes, never team names. This is the blind-judging guarantee.
    await expect(page.getByText("NCSU Nazaare")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "A-114" })).toBeVisible();

    for (let teamIndex = 0; teamIndex < TEAM_COUNT; teamIndex++) {
      const card = cards.nth(teamIndex);
      for (const criterion of CRITERIA) {
        await card
          .getByLabel(criterion.label, { exact: true })
          .fill(String(scoreFor(teamIndex, judgeIndex, criterion.maxPoints)));
      }
      await card.getByRole("button", { name: /Submit|Update/ }).click();
      await expect(card.getByText("Scored")).toBeVisible();
    }

    await context.close();
  }

  const board = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const boardPage = await board.newPage();
  await boardPage.goto(`/board/${demo.boardToken}`);

  await expect(boardPage.getByTestId("progress")).toContainText(
    `${EXPECTED_SCORES} / ${EXPECTED_SCORES}`,
  );

  // Blind until the lock: the board sees bid codes too.
  await expect(boardPage.getByTestId("standings")).toContainText("A-114");
  await expect(boardPage.getByTestId("standings")).not.toContainText("NCSU Nazaare");

  // A deduction is applied to every judge's total for that team, before normalization.
  await boardPage.getByLabel("Team").selectOption({ label: "A-114" });
  await boardPage.getByLabel("Points").fill("2");
  await boardPage.getByLabel("Reason").fill("exceeded time limit by 14s");
  await boardPage.getByRole("button", { name: "Apply deduction" }).click();
  await expect(boardPage.getByText("Applied −2 to the team.")).toBeVisible();

  await boardPage.getByTestId("lock-button").click();

  await expect(boardPage.getByRole("heading", { name: "Final placements" })).toBeVisible();

  const elapsedMinutes = (Date.now() - started) / 60_000;
  expect(elapsedMinutes).toBeLessThan(5);

  // Names are revealed on the lock.
  const standings = boardPage.getByTestId("standings");
  await expect(standings).toContainText("NCSU Nazaare");

  const rows = standings.locator("tr");
  await expect(rows).toHaveCount(TEAM_COUNT);
  await expect(rows.nth(0)).toContainText("NCSU Nazaare");
  await expect(rows.nth(0)).toContainText("−2");
  await expect(rows.nth(TEAM_COUNT - 1)).toContainText("UVA Aayaam");

  const places = await rows.locator("td:first-child").allTextContents();
  expect(places).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);

  // The next-day promise: re-running tabulate() against the stored snapshot reproduces it.
  await expect(boardPage.getByTestId("verification")).toHaveAttribute("data-reproduces", "true");

  await expect(boardPage.getByText("tab.lock")).toBeVisible();
  await expect(boardPage.getByText("deduction.add")).toBeVisible();
  await expect(boardPage.getByText("score.submit").first()).toBeVisible();

  // Post-lock, scoring is closed and nothing is editable.
  const judge = demo.judges[0]!;
  const judgeContext = await browser.newContext();
  const judgePage = await judgeContext.newPage();
  await judgePage.goto(`/judge/${judge.token}`);
  await expect(judgePage.getByRole("status")).toContainText("Scoring is closed");
  await expect(judgePage.getByLabel("Choreography").first()).toBeDisabled();

  await judgeContext.close();
  await board.close();
});

test("a revoked or unknown token gets nothing", async ({ page }) => {
  const notFound = await page.goto("/judge/definitely-not-a-real-token");
  expect(notFound?.status()).toBe(404);

  const boardNotFound = await page.goto("/board/definitely-not-a-real-token");
  expect(boardNotFound?.status()).toBe(404);
});
