import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * P2's rubric builder, and the one property worth an e2e: **a criterion with scores against it
 * cannot be deleted.**
 *
 * `scores.criterion_id` is `onDelete: cascade`, so the database's answer to that request is "yes,
 * done" — and it takes every score against it. That is the right cascade for dropping a whole comp
 * and the wrong one for a board tidying a rubric mid-season, and a foreign key cannot tell the two
 * apart. A unit test proves `planRubric` refuses; only this proves the refusal is what a board
 * actually meets, and that the scores are still there afterwards.
 */

type SeededComp = { compId: string; boardToken: string; judges: { name: string; token: string }[] };

const ORG = "rubric-e2e-org";
const COMP = "rubric-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Rubric E2E Org", slug: ORG },
  comp: { name: "Rubric E2E 2027", slug: COMP, compDate: "2027-03-06", status: "live" },
  rubric: {
    name: "Fusion rubric",
    normalization: "zscore",
    criteria: [
      { label: "Choreography", maxPoints: 30 },
      { label: "Execution", maxPoints: 20 },
    ],
  },
  teams: [
    { name: "Rubric Alpha", bidCode: "R-1", status: "accepted", rosterSize: 18 },
    { name: "Rubric Beta", bidCode: "R-2", status: "accepted", rosterSize: 18 },
  ],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Rubric Chair" }],
};

const seed = (): SeededComp => {
  const config = tmp("rubric.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

/** One judge scores one team, so a criterion has evidence against it. */
const scoreOnce = async (page: Page, judgeToken: string): Promise<void> => {
  await page.goto(`/judge/${judgeToken}`);
  const card = page.locator('form[data-testid^="team-card-"]').first();
  await expect(card).toBeVisible();
  for (const input of await card.locator('input[type="number"]').all()) {
    await input.fill("7");
  }
  await card.getByRole("button", { name: /Submit|Update/ }).click();
  // "Scored", not "submitted" -- the word on the card, taken from `scoring.spec.ts` rather than
  // guessed. A first draft guessed, and three tests failed inside the helper rather than on the
  // thing they were about.
  await expect(card.getByText("Scored")).toBeVisible();
};

test("a board edits its own rubric, which until now meant reseeding the comp", async ({ page }) => {
  const { boardToken } = seed();

  await page.goto(`/board/${boardToken}/results`);
  await expect(page.getByTestId("rubric")).toBeVisible();
  await expect(page.getByTestId("rubric-name")).toHaveValue("Fusion rubric");

  await page.getByTestId("rubric-label-0").fill("Choreography & staging");
  await page.getByTestId("rubric-add").click();
  await page.getByTestId("rubric-label-2").fill("Musicality");
  await page.getByTestId("rubric-max-2").fill("15");
  await page.getByTestId("rubric-save").click();

  await expect(page.getByTestId("rubric-message")).toContainText("Rubric saved");
  await page.reload();
  await expect(page.getByTestId("rubric-label-0")).toHaveValue("Choreography & staging");
  await expect(page.getByTestId("rubric-label-2")).toHaveValue("Musicality");
});

test("a criterion a judge has scored cannot be deleted, and the scores survive the attempt", async ({
  page,
  browser,
}) => {
  const { boardToken, judges } = seed();

  const judgeContext = await browser.newContext();
  const judge = await judgeContext.newPage();
  await scoreOnce(judge, judges[0]!.token);
  await judgeContext.close();

  await page.goto(`/board/${boardToken}/results`);
  // The screen says so before anybody tries, rather than only refusing afterwards.
  await expect(page.getByTestId("rubric-scored-0")).toContainText("scored — fixed");
  await expect(page.getByTestId("rubric-remove-0")).toHaveCount(0);

  // The server does not trust the markup. Rebuild the form without the scored criterion and post it
  // anyway — this is the request the cascade would happily satisfy.
  await page.getByTestId("rubric-label-1").fill("Execution");
  await page.evaluate(() => {
    const form = document.querySelector('[data-testid="rubric"] form') as HTMLFormElement;
    form.querySelectorAll('input[name="criterionId"]')[0]?.remove();
    form.querySelectorAll('input[name="criterionLabel"]')[0]?.remove();
    form.querySelectorAll('input[name="criterionMax"]')[0]?.remove();
    form.querySelectorAll('input[name="criterionWeight"]')[0]?.remove();
  });
  await page.getByTestId("rubric-save").click();

  await expect(page.getByTestId("rubric-message")).toContainText("cannot be removed");
  await expect(page.getByTestId("rubric-message")).toContainText("delete those scores too");

  // And it is still there, with its evidence.
  await page.reload();
  await expect(page.getByTestId("rubric-scored-0")).toBeVisible();
});

test("a scored criterion cannot be re-scaled, because that restates every score already given", async ({
  page,
  browser,
}) => {
  const { boardToken, judges } = seed();

  const judgeContext = await browser.newContext();
  const judge = await judgeContext.newPage();
  await scoreOnce(judge, judges[0]!.token);
  await judgeContext.close();

  await page.goto(`/board/${boardToken}/results`);
  // Readonly on screen; the server refuses regardless, which is what this posts past it to check.
  await page.evaluate(() => {
    const input = document.querySelector(
      '[data-testid="rubric-max-0"]',
    ) as HTMLInputElement;
    input.removeAttribute("readonly");
    input.value = "50";
  });
  await page.getByTestId("rubric-save").click();

  await expect(page.getByTestId("rubric-message")).toContainText("is not a 24 out of 50");
});

test("the rubric stops being editable once a result is locked", async ({ page, browser }) => {
  const { boardToken, judges } = seed();

  const judgeContext = await browser.newContext();
  const judge = await judgeContext.newPage();
  await scoreOnce(judge, judges[0]!.token);
  await judgeContext.close();

  await page.goto(`/board/${boardToken}`);
  // `lock-button`, and the heading is how `scoring.spec.ts` knows it landed. Taken from there
  // rather than invented, which is the second time in this file that guessing a selector cost a run.
  await page.getByTestId("lock-button").click();
  await expect(page.getByRole("heading", { name: "Final placements" })).toBeVisible();

  await page.goto(`/board/${boardToken}/results`);
  await expect(page.getByTestId("rubric-locked")).toContainText("reproduces from its own frozen");
  await expect(page.getByTestId("rubric-save")).toHaveCount(0);
});
