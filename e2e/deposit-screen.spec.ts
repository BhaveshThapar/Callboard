import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * A7, driven from the screen instead of from a fixture.
 *
 * `e2e/money.spec.ts` already proves `deposit_events_terminal_unique` refuses a second ending, and
 * it proves it by writing straight at the database through `e2e/support/deposit.ts`, whose header
 * says that bypass "is the entire point". It was more literally true than intended:
 * `advanceDeposit` and `listDepositsForBoard` had **no importer anywhere**, so the index was tested
 * and the product path above it did not exist. The machine's guards — terminal, disallowed
 * transition, the constraint catch — had never run.
 *
 * This file drives the states a board actually moves a deposit through, and then re-checks that the
 * index still refuses a second ending underneath the screen.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "deposit-screen-e2e-org";
const COMP = "deposit-screen-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Deposit Screen Org", slug: ORG },
  comp: { name: "Deposit Screen 2027", slug: COMP, compDate: "2027-03-06", status: "open" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [
    { name: "Accepted Beta", bidCode: "M-2", status: "accepted", rosterSize: 20, rooms: 5 },
    { name: "Accepted Gamma", bidCode: "M-3", status: "accepted", rosterSize: 12, rooms: 3 },
  ],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Money Chair" }],
  feeSchedule: {
    perDancerCents: 7000,
    perRoomCents: 14000,
    depositCents: 10000,
    lateFeeCents: 2500,
    lateAfter: "2099-01-01",
  },
};

const seed = (): SeededComp => {
  const config = tmp("deposit-screen.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const depositFixture = (...args: string[]): string =>
  execFileSync("bunx", ["tsx", "e2e/support/deposit.ts", ...args], { encoding: "utf8" }).trim();

const money = async (page: Page, token: string): Promise<void> => {
  await page.goto(`/board/${token}/money`);
  await expect(page.getByTestId("deposits")).toBeVisible();
};

const move = async (page: Page, bidCode: string, to: string): Promise<void> => {
  await page.getByTestId(`deposit-${bidCode}-${to}`).click();
  await expect(page.getByTestId(`deposit-row-${bidCode}`)).toHaveAttribute("data-state", to);
};

test("a board returns a deposit from the screen, and the row goes terminal", async ({ browser }) => {
  const comp = seed();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await money(page, comp.boardToken);

  const row = page.getByTestId("deposit-row-M-2");
  await expect(row).toHaveAttribute("data-state", "held");

  await move(page, "M-2", "refund_pending");
  await move(page, "M-2", "refunded");

  // Terminal: the state is the row, and there is nothing left to press.
  await expect(page.getByTestId("deposit-M-2-refund_pending")).toHaveCount(0);
  await expect(page.getByTestId("deposit-M-2-forfeited")).toHaveCount(0);
  await expect(row).toContainText("refunded");

  // And the index still refuses a second ending from a path that never asked the machine. This is
  // money.spec.ts's claim, re-checked with a product path now sitting above it.
  expect(depositFixture("append", comp.compId, "M-2", "refunded")).toBe(
    "refused:deposit_events_terminal_unique",
  );
  expect(depositFixture("state", comp.compId, "M-2")).toBe("refunded");
});

test("a bounced return is retried from the screen, because the money never left", async ({
  browser,
}) => {
  const comp = seed();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await money(page, comp.boardToken);

  // `refund_failed` is deliberately not terminal: an ACH return that bounces is retryable, and an
  // ending there would strand the money in a state the product cannot leave.
  await move(page, "M-2", "refund_pending");
  await move(page, "M-2", "refund_failed");
  await move(page, "M-2", "held");
  await move(page, "M-2", "refund_pending");
  await move(page, "M-2", "refunded");

  expect(depositFixture("state", comp.compId, "M-2")).toBe("refunded");
});

test("forfeiting needs a reason, and nothing is written without one", async ({ browser }) => {
  const comp = seed();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await money(page, comp.boardToken);

  // Keeping a team's money is a decision that has to be explainable. Returning it is not.
  await page.getByTestId("deposit-M-3-forfeited").click();
  await expect(page.getByTestId("deposit-message")).toContainText("needs a written reason");
  await expect(page.getByTestId("deposit-row-M-3")).toHaveAttribute("data-state", "held");
  expect(depositFixture("state", comp.compId, "M-3")).toBe("held");

  await page.getByTestId("deposit-reason-M-3").fill("Prop box exceeded the stated dimensions");
  await page.getByTestId("deposit-M-3-forfeited").click();
  await expect(page.getByTestId("deposit-row-M-3")).toHaveAttribute("data-state", "forfeited");
});

/**
 * There are two guards and they cover different windows, which is worth being precise about
 * because only one of them is reachable from a browser.
 *
 * `advanceDeposit` re-reads the chain when the action runs rather than trusting the render the
 * button came from, so a deposit somebody else closed *before* the click is caught in process and
 * the insert never happens. That is the realistic case — a stale tab, a double click, two board
 * members a minute apart — and it is what this test drives.
 *
 * The `deposit_events_terminal_unique` catch covers the window that read cannot: a write landing
 * between it and the INSERT, microseconds wide. No browser test can force it, which is exactly why
 * `money.spec.ts` proves it by writing straight at the database instead of pretending to.
 */
test("a deposit closed elsewhere is refused in process, with a sentence and never SQL", async ({
  browser,
}) => {
  const comp = seed();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await money(page, comp.boardToken);
  await move(page, "M-2", "refund_pending");

  // Somebody else finishes it while this board member's page sits open.
  expect(depositFixture("append", comp.compId, "M-2", "refunded")).toBe("appended");

  await page.getByTestId("deposit-M-2-refunded").click();
  const message = page.getByTestId("deposit-message");
  await expect(message).toContainText("already refunded");
  await expect(message).toContainText("A deposit ends once");
  await expect(message).not.toContainText("Failed query");

  // Nothing was written by the refused click: still one ending, not two.
  expect(depositFixture("state", comp.compId, "M-2")).toBe("refunded");
});
