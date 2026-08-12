import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

/**
 * A7's receipt — the half `FEATURE_MAP` recorded as **not built** from the day the refund state
 * machine shipped.
 *
 * `payments` has held gross, fee and net since the ledger landed and never told a team any of it, so
 * a treasurer confirming a $2,160 Venmo lump had one instrument: a screenshot in a text message.
 *
 * The receipt is queued **after** the ledger's transaction, never inside it — a comms failure must
 * not roll back money that genuinely arrived — and the transport records rather than sends.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "receipts-e2e-org";
const COMP = "receipts-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Receipts E2E Org", slug: ORG },
  comp: { name: "Receipts E2E 2027", slug: COMP, compDate: "2027-03-06", status: "open" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [
    // 20 x $70 + 5 x $140 + $100 = $2,200.00
    {
      name: "Has Captain",
      bidCode: "M-2",
      status: "accepted",
      rosterSize: 20,
      rooms: 5,
      contact: { name: "Meera Iyer", email: "meera@example.com" },
    },
    // Same money, nobody to tell. The row that proves the board is told so.
    { name: "No Captain", bidCode: "M-3", status: "accepted", rosterSize: 20, rooms: 5 },
  ],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Receipts Chair" }],
  feeSchedule: { perDancerCents: 7000, perRoomCents: 14000, depositCents: 10000, lateFeeCents: 0 },
};

const seed = (): SeededComp => {
  const config = tmp("receipts.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const comms = (...args: string[]): string =>
  execFileSync("bunx", ["tsx", "e2e/support/comms.ts", ...args], { encoding: "utf8" }).trim();

const pay = async (
  page: Page,
  token: string,
  fields: { team: string; gross: string; fee?: string; receipt?: boolean; toDeposit?: string },
): Promise<void> => {
  await page.goto(`/board/${token}/money`);
  await expect(page.getByTestId("record-payment")).toBeVisible();

  const option = page
    .locator('[data-testid="payment-team"] option')
    .filter({ hasText: fields.team });
  await page.getByTestId("payment-team").selectOption((await option.first().getAttribute("value")) ?? "");
  await page.getByTestId("payment-rail").selectOption("venmo");
  await page.getByTestId("payment-gross").fill(fields.gross);
  if (fields.fee) await page.getByTestId("payment-fee").fill(fields.fee);
  // A deposit nobody paid cannot be returned — that is ADR-0015's guard, not scaffolding — so a
  // refund test has to attach the money to the deposit charge rather than leave it as credit.
  if (fields.toDeposit) await page.getByTestId("payment-allocation-deposit").fill(fields.toDeposit);
  if (fields.receipt === false) await page.getByTestId("payment-receipt").uncheck();
  await page.getByTestId("payment-submit").click();

  // Wait for the action to answer before returning. Without this a caller that navigates straight
  // afterwards races the server action, and reads a deposit that has not been paid yet — which is
  // exactly how this passed alone and failed in a full run, where everything is slower.
  await expect(page.getByTestId("payment-message")).toBeVisible();
};

test("a receipt tells the captain what arrived, what it cost, and what is left", async ({
  page,
}) => {
  const comp = seed();

  // $2,200 owed, $500 in by Venmo with a $2.99 fee. The team is credited the gross.
  await pay(page, comp.boardToken, { team: "Has Captain", gross: "500.00", fee: "2.99" });
  await expect(page.getByTestId("payment-message")).toContainText("receipt is on its way");

  expect(comms("count", COMP)).toBe("1");
  expect(comms("recipients", COMP)).toBe("payment.receipt meera@example.com $1,700.00");
});

/**
 * The reason the box exists at all: a treasurer backfilling last season on a Sunday must not mail
 * thirty captains who were not expecting anything.
 */
test("unticking the box records the money and sends nothing", async ({ page }) => {
  const comp = seed();

  await pay(page, comp.boardToken, { team: "Has Captain", gross: "500.00", receipt: false });
  const message = page.getByTestId("payment-message");
  await expect(message).toContainText("Recorded");
  await expect(message).not.toContainText("receipt");

  expect(comms("count", COMP)).toBe("0");
});

/**
 * Named rather than swallowed, for the same reason A10 names the teams it could not chase: a board
 * that ticked the box and got nothing sent has to be told, or it will believe otherwise.
 */
test("a team with no captain is told, rather than quietly not receipted", async ({ page }) => {
  const comp = seed();

  await pay(page, comp.boardToken, { team: "No Captain", gross: "500.00" });
  await expect(page.getByTestId("payment-message")).toContainText("no captain on file");

  expect(comms("count", COMP)).toBe("0");
});

/**
 * The other half of A7. A refund is **not** a negative payment ([ADR-0015]), so it is not a
 * `payment.receipt` with a minus sign — and the number the notice has to carry is the one that did
 * *not* move: `refunded` voids the obligation and releases its allocations together, so a captain
 * must not read the return as a fresh bill.
 *
 * There is deliberately no forfeit notice. A board keeping a team's money should say that itself.
 */
test("a returned deposit tells the captain, and a forfeited one does not", async ({ page }) => {
  const comp = seed();

  // Pay the deposit, then return it. `held → refund_pending → refunded` is two acts, because a
  // bounced ACH return is retryable and an ending there would strand the money.
  await pay(page, comp.boardToken, {
    team: "Has Captain",
    gross: "100.00",
    toDeposit: "100.00",
    receipt: false,
  });
  await page.goto(`/board/${comp.boardToken}/money`);

  await page.getByTestId("deposit-M-2-refund_pending").click();
  await expect(page.getByTestId("deposit-row-M-2")).toHaveAttribute("data-state", "refund_pending");
  await page.getByTestId("deposit-M-2-refunded").click();
  await expect(page.getByTestId("deposit-message")).toContainText("captain has been told");
  await expect(page.getByTestId("deposit-row-M-2")).toHaveAttribute("data-state", "refunded");

  expect(comms("recipients", COMP)).toContain("deposit.returned meera@example.com");

  // The other team forfeits, and nothing is queued about it.
  const before = comms("count", COMP);
  await page.getByTestId("deposit-reason-M-3").fill("no prop box dimensions");
  await page.getByTestId("deposit-M-3-forfeited").click();
  await expect(page.getByTestId("deposit-row-M-3")).toHaveAttribute("data-state", "forfeited");

  expect(comms("count", COMP)).toBe(before);
});

test("what the receipt queues is what the sweep sends", async ({ page }) => {
  const comp = seed();

  await pay(page, comp.boardToken, { team: "Has Captain", gross: "2200.00" });
  await expect(page.getByTestId("payment-message")).toContainText("receipt is on its way");

  // Settled, and the receipt says so — the most useful one there is.
  expect(comms("recipients", COMP)).toBe("payment.receipt meera@example.com $0.00");
  expect(comms("sweep", COMP)).toBe("1 1 0 0");
  expect(comms("sent", COMP)).toBe("1");
});
