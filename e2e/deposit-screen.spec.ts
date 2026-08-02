import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

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

/**
 * A deposit nobody paid cannot be returned, so every refund test has to put the money in first.
 * That is not test scaffolding — it is the guard ADR-0015 added, and the last test here drives it.
 */
const payDeposit = async (page: Page, token: string, bidCode: string): Promise<void> => {
  await page.goto(`/board/${token}/money`);
  const option = page
    .locator('[data-testid="payment-team"] option')
    .filter({ hasText: `(${bidCode})` });
  await page.getByTestId("payment-team").selectOption((await option.first().getAttribute("value")) ?? "");
  await page.getByTestId("payment-rail").selectOption("venmo");
  await page.getByTestId("payment-gross").fill("100.00");
  await page.getByTestId("payment-allocation-deposit").fill("100.00");
  await page.getByTestId("payment-submit").click();
  await expect(page.getByTestId("payment-message")).toContainText("Recorded");
};

const balanceCents = async (page: Page, bidCode: string): Promise<string | null> =>
  page.getByTestId(`owes-row-${bidCode}`).getAttribute("data-balance-cents");

/** Found by the obligation it settles: the allocation id is only knowable from the rendered row. */
const releaseButton = (page: Page, kind: string) =>
  page
    .locator('[data-testid^="allocation-"]')
    .filter({ hasText: kind })
    .getByRole("button", { name: "release" });

test("a board returns a deposit from the screen, and the row goes terminal", async ({ page }) => {
  const comp = seed();

  await payDeposit(page, comp.boardToken, "M-2");
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

test("a bounced return is retried from the screen, because the money never left", async ({ page }) => {
  const comp = seed();

  await payDeposit(page, comp.boardToken, "M-2");
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

test("forfeiting needs a reason, and nothing is written without one", async ({ page }) => {
  const comp = seed();

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
test("a deposit closed elsewhere is refused in process, with a sentence and never SQL", async ({ page }) => {
  const comp = seed();

  await payDeposit(page, comp.boardToken, "M-2");
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

/**
 * The assertion A7 was missing for a day, and the reason ADR-0015 exists.
 *
 * A refund used to move **no number anywhere**: the deposit charge stayed live so `owed` still
 * counted it, `paid` was `sum(gross)` so it still counted the money, and the team read *settled*
 * while the cash sat in the team's account rather than the org's. PRD §13 promises a reconciliation
 * error of $0 against the bank, and that was a gap of exactly the shape the product is sold against.
 */
test("a returned deposit stops being owed and stops being counted as paid", async ({ page }) => {
  const comp = seed();

  // M-2 owes 20 x $70 + 5 x $140 + $100 = $2,200 and pays the $100 deposit.
  await payDeposit(page, comp.boardToken, "M-2");
  expect(await balanceCents(page, "M-2")).toBe("210000");

  await money(page, comp.boardToken);
  await expect(page.getByTestId("deposit-row-M-2")).toHaveAttribute("data-paid-cents", "10000");

  await move(page, "M-2", "refund_pending");
  await move(page, "M-2", "refunded");

  // Owed drops by the $100 obligation and paid drops by the $100 that went back out, so the balance
  // does not move -- and the org's books no longer claim to hold money they returned.
  expect(await balanceCents(page, "M-2")).toBe("210000");
  await expect(page.getByTestId("deposit-row-M-2")).toHaveAttribute("data-settled", "true");
  await expect(page.getByTestId("charge-M-2-deposit")).toHaveCount(0);

  /**
   * And the returned money is **not offered back as credit**, which it was for one commit.
   * Refunding releases the deposit's allocations, so `allocated_cents` drops to 0 while
   * `gross_cents` stays — and `gross - allocated` put the whole payment on the unattributed panel,
   * inviting a board to attach money that had left the account to a live obligation. The
   * subtraction is `gross - allocated - refunded`, in one place, for exactly this reason.
   */
  await expect(page.getByTestId("unattributed")).toHaveCount(0);
});

test("a forfeited deposit moves nothing, because the org keeps it against what was owed", async ({ page }) => {
  const comp = seed();

  await payDeposit(page, comp.boardToken, "M-3");
  // M-3 owes 12 x $70 + 3 x $140 + $100 = $1,360, less the $100 paid.
  expect(await balanceCents(page, "M-3")).toBe("126000");

  await money(page, comp.boardToken);
  await page.getByTestId("deposit-reason-M-3").fill("Withdrew after the roster deadline");
  await move(page, "M-3", "forfeited");

  // The charge stays live and the payment stays counted. Every number was already right, and the
  // asymmetry with a refund is the model rather than an omission.
  expect(await balanceCents(page, "M-3")).toBe("126000");
  await expect(page.getByTestId("deposit-row-M-3")).toHaveAttribute("data-settled", "false");
  await expect(page.getByTestId("charge-M-3-deposit")).toHaveAttribute("data-paid-cents", "10000");
});

/**
 * The deposit a board most needs to decide about is the one the product could not reach.
 *
 * `listDepositsForBoard` read the roster window's `charges`, which are filtered to `voided_at is
 * null`. Dropping a team voids every charge it holds, so the row left the table at exactly the
 * moment *forfeit or refund?* gets asked, and the action answered "that deposit is not one of this
 * comp's".
 */
test("a dropped team's deposit can still be forfeited, which is when the question is asked", async ({ page }) => {
  const comp = seed();

  await payDeposit(page, comp.boardToken, "M-2");

  await page.goto(`/board/${comp.boardToken}/roster`);
  const row = page.getByTestId("roster-row-M-2");
  await row.getByRole("button", { name: "dropped", exact: true }).click();
  await expect(row).toHaveAttribute("data-status", "dropped");

  await money(page, comp.boardToken);
  const deposit = page.getByTestId("deposit-row-M-2");
  await expect(deposit).toHaveAttribute("data-settled", "true");
  await expect(deposit).toHaveAttribute("data-paid-cents", "10000");

  await page.getByTestId("deposit-reason-M-2").fill("Dropped after the refund deadline");
  await move(page, "M-2", "forfeited");
  expect(depositFixture("state", comp.compId, "M-2")).toBe("forfeited");
});

/**
 * "A deposit ends once" was true of a charge row rather than of a deposit.
 *
 * The terminal index was keyed on `charge_id`, and `planCharges` voids and re-inserts a charge
 * whenever its amount changes — so regenerating after a refund minted a fresh id with an empty
 * chain, and an already-refunded deposit became refundable again. Keyed on `(comp_id, team_id)` it
 * survives, which is the whole of migration `0011`.
 */
test("a refunded deposit stays ended after its charge is regenerated", async ({ page }) => {
  const comp = seed();

  await payDeposit(page, comp.boardToken, "M-2");
  await money(page, comp.boardToken);
  await move(page, "M-2", "refund_pending");
  await move(page, "M-2", "refunded");

  // Regeneration re-bills the deposit, because M-2 is still an accepted team that owes one.
  await page.getByTestId("regenerate-charges").click();
  await expect(page.getByTestId("regenerate-message")).toBeVisible();

  await money(page, comp.boardToken);
  const row = page.getByTestId("deposit-row-M-2");
  await expect(row).toHaveAttribute("data-state", "refunded");
  await expect(page.getByTestId("deposit-M-2-refund_pending")).toHaveCount(0);

  // And the index still refuses one underneath the screen, from a path that never asked.
  expect(depositFixture("append", comp.compId, "M-2", "refunded")).toBe(
    "refused:deposit_events_terminal_unique",
  );
});

test("a deposit nobody paid cannot be returned, but can be forfeited", async ({ page }) => {
  const comp = seed();

  await money(page, comp.boardToken);
  await expect(page.getByTestId("deposit-row-M-2")).toHaveAttribute("data-paid-cents", "0");

  await page.getByTestId("deposit-M-2-refund_pending").click();
  await expect(page.getByTestId("deposit-message")).toContainText("nothing to return");
  expect(depositFixture("state", comp.compId, "M-2")).toBe("held");

  // Forfeiting one is deliberately still legal: it is how a board records that a slot was held and
  // never paid for.
  await page.getByTestId("deposit-reason-M-2").fill("Slot held, never paid");
  await move(page, "M-2", "forfeited");
});

/**
 * The interaction between the two things built on August 2, and the reason both needed a test
 * together rather than only apart.
 *
 * `paidCents` counts a deposit's *voided* allocations too, because `voidChargesFor` releases them
 * when a team drops and counting only live ones would report $0 paid for the deposit a board most
 * needs to decide about. But releasing an allocation by hand voids one as well — so a board that
 * corrected a mis-typed deposit allocation left two rows against one charge, and counting both read
 * $200 paid against a $100 deposit. The refund would then be refused by `payments_refunded_check`
 * rather than performed: a wrong number turning into a refusal, which is the better failure of the
 * two and still the wrong one.
 *
 * The rule is the charge, not the allocation: live charge → live allocations, voided charge → all
 * of them.
 */
test("a deposit paid, released and re-attached is refunded once, not twice", async ({ page }) => {
  const comp = seed();

  await payDeposit(page, comp.boardToken, "M-2");
  await money(page, comp.boardToken);
  await expect(page.getByTestId("deposit-row-M-2")).toHaveAttribute("data-paid-cents", "10000");

  // The board decides that $100 was meant for the hotel, takes it back, then puts it where it was.
  await releaseButton(page, "deposit").click();
  await expect(page.getByTestId("release-message")).toContainText("$100.00");
  await expect(page.getByTestId("deposit-row-M-2")).toHaveAttribute("data-paid-cents", "0");

  await page.getByTestId("apply-M-2-deposit").fill("100.00");
  await page.getByTestId("apply-submit-M-2").click();
  await expect(page.getByTestId("charge-M-2-deposit")).toHaveAttribute("data-paid-cents", "10000");

  // One live allocation and one voided one against the same live charge. $100 arrived, not $200.
  await money(page, comp.boardToken);
  await expect(page.getByTestId("deposit-row-M-2")).toHaveAttribute("data-paid-cents", "10000");

  await move(page, "M-2", "refund_pending");
  await move(page, "M-2", "refunded");

  // M-2 owes $2,200 and paid $100, which went back. Both sides fall by $100 and the balance holds.
  expect(await balanceCents(page, "M-2")).toBe("210000");
});
