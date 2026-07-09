import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * PRD B6: "nothing editable after lock without a logged, attributed override."
 *
 * The claim has two halves that this file separates. A correction must actually change the
 * placements — otherwise the override is ceremony — and it must leave the superseded run intact,
 * naming the person who authorized it.
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

const TEAM_COUNT = 8;

/** Strictly decreasing in team index, so A-114 leads by a wide margin before the correction. */
const scoreFor = (teamIndex: number, maxPoints: number): number =>
  Math.max(0, maxPoints - teamIndex * 2);

const seed = (): SeededDemo => {
  const file = join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), "demo.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--json", file], { stdio: "pipe" });
  return JSON.parse(readFileSync(file, "utf8")) as SeededDemo;
};

test("a locked result is corrected by superseding it, never by editing it", async ({ browser }) => {
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
        .fill(String(scoreFor(teamIndex, criterion.maxPoints)));
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

  const standings = boardPage.getByTestId("standings");
  await expect(standings.locator("tr").nth(0)).toContainText("NCSU Nazaare");
  await expect(boardPage.getByText("Run 1, locked at")).toBeVisible();

  // The reason is not optional, in the browser or on the server.
  const reason = boardPage.getByLabel("Reason for the correction");
  await expect(reason).toHaveAttribute("required", "");

  // The correction the demo tells: a time penalty everyone forgot to apply.
  await reason.fill("Time penalty for NCSU was missed during scoring.");
  await boardPage.getByLabel("Team to deduct from").selectOption({ label: "NCSU Nazaare" });
  await boardPage.getByLabel("Deduction points").fill("20");
  await boardPage.getByLabel("Reason for the deduction").fill("exceeded time limit by 14s");
  await boardPage.getByTestId("override-button").click();

  await expect(boardPage.getByText("Run 2 supersedes run 1.")).toBeVisible();

  // The placements actually moved. An override that cannot change anything proves nothing.
  await expect(standings.locator("tr").nth(0)).not.toContainText("NCSU Nazaare");
  await expect(standings).toContainText("−20");

  // The new run names itself a correction, and carries the reason forward.
  await expect(boardPage.getByText("Run 2, locked at")).toBeVisible();
  await expect(boardPage.getByText("a correction of the run before it")).toBeVisible();
  await expect(
    boardPage.getByText("Time penalty for NCSU was missed during scoring."),
  ).toBeVisible();

  // The frozen snapshot of the *new* run still reproduces.
  await expect(boardPage.getByTestId("verification")).toHaveAttribute("data-reproduces", "true");

  // Logged and attributed, which is the whole of PRD B6.
  await expect(boardPage.getByText("tab.override")).toBeVisible();
  await expect(boardPage.getByText(demo.boardName).first()).toBeVisible();

  await board.close();
});
