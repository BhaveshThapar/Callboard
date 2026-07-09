import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Revoking a judge kills their link, not their scores. `judge_assignments.revoked_at` was read by
 * the auth layer and written by nothing, so a link texted out in February still opened in March.
 */

type SeededDemo = {
  compId: string;
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

const seed = (): SeededDemo => {
  const file = join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), "demo.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--json", file], { stdio: "pipe" });
  return JSON.parse(readFileSync(file, "utf8")) as SeededDemo;
};

test("a revoked judge loses the link and keeps the scores", async ({ browser }) => {
  const demo = seed();
  const judge = demo.judges[0]!;

  // The judge scores exactly one team, then the board revokes them mid-comp.
  const judgeContext = await browser.newContext();
  const judgePage = await judgeContext.newPage();
  await judgePage.goto(`/judge/${judge.token}`);

  const card = judgePage.locator('form[data-testid^="team-card-"]').first();
  for (const criterion of CRITERIA) {
    await card.getByLabel(criterion.label, { exact: true }).fill(String(criterion.maxPoints));
  }
  await card.getByRole("button", { name: /Submit|Update/ }).click();
  await expect(card.getByText("Scored")).toBeVisible();
  await judgeContext.close();

  const board = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const boardPage = await board.newPage();
  await boardPage.goto(`/board/${demo.boardToken}`);

  // 4 of 96: three judges are expected, and one has scored one team.
  await expect(boardPage.getByTestId("progress")).toContainText("4 / 96");

  // The sidebar is ordered by name, so target the judge who actually scored.
  const scored = boardPage.locator("aside li").filter({ hasText: judge.name });
  await scored.getByRole("button", { name: "Revoke link" }).click();
  await expect(boardPage.getByText("That scoring link no longer opens.")).toBeVisible();
  await expect(scored.getByText("revoked")).toBeVisible();

  // Their scores still count, so they stay on both sides of the fraction and it cannot exceed 100%.
  await expect(boardPage.getByTestId("progress")).toContainText("4 / 96");
  await expect(boardPage.getByTestId("standings")).toContainText("A-114");

  // A judge revoked before scoring anything -- a link killed because it leaked -- leaves entirely,
  // taking their share of the denominator with them, so the bar can still reach 100%.
  const neverScored = boardPage.locator("aside li").filter({ hasText: demo.judges[1]!.name });
  await neverScored.getByRole("button", { name: "Revoke link" }).click();
  await expect(boardPage.getByTestId("progress")).toContainText("4 / 64");

  // The link itself is dead.
  const revisit = await boardPage.goto(`/judge/${judge.token}`);
  expect(revisit?.status()).toBe(404);

  await board.close();
});
