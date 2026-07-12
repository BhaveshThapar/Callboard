import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * A board link is bearer access to the lock, the override, the results page and both CSV exports.
 * `board_assignments.revoked_at` was read by the auth layer and written by nothing, so a link
 * forwarded into a group chat could not be killed from the product at all — only from the database.
 *
 * The last test is the one that matters. Two board members revoking each other at the same instant
 * both pass the application's `refuseRevoke`, and two plain UPDATEs would both land and leave the
 * comp with no link that opens: nobody could lock it, correct it, or download its results, ever, and
 * nothing in the product mints a new one. The `for update` CTE in `revokeBoardAction` is what makes
 * that unreachable. Delete `and (select count(*) from live) >= 2` from it and this spec produces a
 * comp with zero live board links.
 */

type SeededDemo = {
  compName: string;
  boardToken: string;
  board: { name: string; token: string }[];
  judges: { name: string; token: string }[];
};

const CRITERIA = [
  { label: "Choreography", maxPoints: 30 },
  { label: "Execution", maxPoints: 30 },
  { label: "Musicality", maxPoints: 20 },
  { label: "Stage Presence", maxPoints: 20 },
];

const TEAM_COUNT = 8;
const VIEWPORT = { width: 1280, height: 900 };

const seed = (): SeededDemo => {
  const file = join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), "demo.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--json", file], { stdio: "pipe" });
  return JSON.parse(readFileSync(file, "utf8")) as SeededDemo;
};

/** The sidebar lists judges and board members alike; the names are what tell them apart. */
const rowFor = (page: Page, name: string) => page.locator("aside li").filter({ hasText: name });

const scoreEveryTeam = async (page: Page): Promise<void> => {
  const cards = page.locator('form[data-testid^="team-card-"]');
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
};

test("a revoked board link stops opening, and the comp keeps one that does", async ({ browser }) => {
  const demo = seed();
  const [ananya, rohit] = [demo.board[0]!, demo.board[1]!];

  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(`/board/${ananya.token}`);

  await rowFor(page, rohit.name).getByRole("button", { name: "Revoke link" }).click();
  await expect(page.getByText("That board link no longer opens.")).toBeVisible();
  await expect(rowFor(page, rohit.name).getByText("revoked")).toBeVisible();

  // The kill has a name on it. Server-rendered, so it arrives on a reload rather than on the poll.
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByText("board.revoke").count();
      },
      { timeout: 20_000 },
    )
    .toBe(1);

  const dead = await page.goto(`/board/${rohit.token}`);
  expect(dead?.status()).toBe(404);

  // And the one that did the revoking still opens: the comp is still administrable.
  const alive = await page.goto(`/board/${ananya.token}`);
  expect(alive?.status()).toBe(200);

  await context.close();
});

test("a board member cannot revoke their own link", async ({ browser }) => {
  const demo = seed();
  const [ananya, rohit] = [demo.board[0]!, demo.board[1]!];

  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(`/board/${ananya.token}`);

  // Nothing re-issues a board link, so self-revoke is a one-way exit -- and refusing it is also what
  // guarantees a comp can never be left with no link at all. There is no control to click.
  const self = rowFor(page, ananya.name);
  await expect(self.getByText("you")).toBeVisible();
  await expect(self.getByRole("button", { name: "Revoke link" })).toHaveCount(0);

  // The other member's link is revocable, which is what makes the absence above a rule and not a
  // missing feature.
  await expect(rowFor(page, rohit.name).getByRole("button", { name: "Revoke link" })).toBeVisible();

  await context.close();
});

test("a board link can still be revoked after the lock, when a judge link cannot", async ({
  browser,
}) => {
  const demo = seed();
  const [ananya, rohit] = [demo.board[0]!, demo.board[1]!];
  const judge = demo.judges[0]!;

  const judgeContext = await browser.newContext();
  const judgePage = await judgeContext.newPage();
  await judgePage.goto(`/judge/${judge.token}`);
  await scoreEveryTeam(judgePage);
  await judgeContext.close();

  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(`/board/${ananya.token}`);
  await page.getByTestId("lock-button").click();
  await expect(page.getByRole("heading", { name: "Final placements" })).toBeVisible();

  // A judge's link only authorized scoring, and scoring is closed, so revoking it now is moot.
  await expect(rowFor(page, judge.name).getByRole("button", { name: "Revoke link" })).toHaveCount(0);

  // A board link still authorizes the override and both exports, so this is the moment a leaked one
  // is *most* worth killing -- exactly where the judge guard would have refused.
  await rowFor(page, rohit.name).getByRole("button", { name: "Revoke link" }).click();
  await expect(page.getByText("That board link no longer opens.")).toBeVisible();

  const dead = await page.goto(`/board/${rohit.token}`);
  expect(dead?.status()).toBe(404);

  await context.close();
});

test("two board members revoking each other leave the comp one link, not zero", async ({
  browser,
}) => {
  const demo = seed();
  const [ananya, rohit] = [demo.board[0]!, demo.board[1]!];

  const [first, second] = await Promise.all([
    browser.newContext({ viewport: VIEWPORT }),
    browser.newContext({ viewport: VIEWPORT }),
  ]);
  const [pageA, pageB] = await Promise.all([first.newPage(), second.newPage()]);

  await Promise.all([
    pageA.goto(`/board/${ananya.token}`),
    pageB.goto(`/board/${rohit.token}`),
  ]);

  // Each sees the other as revocable. Neither is aware of the other's click.
  await expect(rowFor(pageA, rohit.name).getByRole("button", { name: "Revoke link" })).toBeVisible();
  await expect(
    rowFor(pageB, ananya.name).getByRole("button", { name: "Revoke link" }),
  ).toBeVisible();

  // Wait for both server actions to *return*, not merely for both clicks to dispatch. Polling the
  // links until one dies would be worse than useless here: if both revocations were going to land,
  // the poll could catch the instant between them, see exactly one survivor, and pass -- reporting
  // the guard as working at the precise moment it was not. Both writes have settled below, so the
  // assertion that follows runs once and cannot be fooled.
  const revoked = (page: Page, token: string) =>
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().includes(`/board/${token}`),
    );

  await Promise.all([
    revoked(pageA, ananya.token),
    revoked(pageB, rohit.token),
    rowFor(pageA, rohit.name).getByRole("button", { name: "Revoke link" }).click(),
    rowFor(pageB, ananya.name).getByRole("button", { name: "Revoke link" }).click(),
  ]);

  // Whichever board member lost is told a person got there first, or that a comp has to keep a link
  // -- never shown the SQL Postgres refused. Drizzle's own message is the failed UPDATE, and a plan
  // inversion here would surface as a deadlock. Which of the two messages appears is a timing
  // detail; neither may be a stack trace.
  for (const page of [pageA, pageB]) {
    await expect(page.getByText(/Failed query|deadlock|violates|constraint/i)).toHaveCount(0);
  }

  // Exactly one link survives. Without the count guard in the CTE both revocations land and both of
  // these 404 -- a comp nobody can ever administer again.
  const statuses = await Promise.all(
    [ananya, rohit].map(async (member) => {
      const response = await pageA.request.get(`/board/${member.token}`);
      return response.status();
    }),
  );
  expect(statuses.filter((status) => status === 200)).toHaveLength(1);
  expect(statuses.filter((status) => status === 404)).toHaveLength(1);

  // One revocation landed, so the trail records one. Two would mean the comp was bricked.
  const survivor = statuses[0] === 200 ? ananya : rohit;
  const page = await first.newPage();
  await expect
    .poll(
      async () => {
        await page.goto(`/board/${survivor.token}`);
        return page.getByText("board.revoke").count();
      },
      { timeout: 20_000 },
    )
    .toBe(1);

  await Promise.all([first.close(), second.close()]);
});
