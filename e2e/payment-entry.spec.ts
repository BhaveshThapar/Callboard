import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

/**
 * A8, driven through the product rather than around it.
 *
 * `e2e/money.spec.ts` reaches the ledger through `e2e/support/pay.ts`, which calls itself "a test
 * fixture, not a product path" — and that was accurate in a way nobody had noticed: `recordPayment`
 * had **no caller anywhere**, in `src/app`, in `src/lib`, or in any test. A7 and A8 were marked Live
 * over a library the product never executed. The suite was green because it was written around the
 * missing path.
 *
 * So every payment here is typed into the form a treasurer would use. The seed is
 * `money.spec.ts`'s own schedule ($70/dancer, $140/room, $100 deposit) so every figure below is
 * checkable by hand.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "payment-entry-e2e-org";
const COMP = "payment-entry-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Payment Entry Org", slug: ORG },
  comp: { name: "Payment Entry 2027", slug: COMP, compDate: "2027-03-06", status: "open" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [
    { name: "Applied Alpha", bidCode: "M-1", status: "applied", rosterSize: 16, rooms: 4 },
    { name: "Accepted Beta", bidCode: "M-2", status: "accepted", rosterSize: 20, rooms: 5 },
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
  const config = tmp("payment-entry.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const money = async (page: Page, token: string): Promise<void> => {
  await page.goto(`/board/${token}/money`);
  await expect(page.getByTestId("record-payment")).toBeVisible();
};

const accept = async (page: Page, token: string, bidCode: string): Promise<void> => {
  await page.goto(`/board/${token}/roster`);
  const row = page.getByTestId(`roster-row-${bidCode}`);
  await row.getByRole("button", { name: "accepted", exact: true }).click();
  await expect(row).toHaveAttribute("data-status", "accepted");
};

/** The option's value is a team id, so it is looked up by the bid code the test actually knows. */
const pickTeam = async (page: Page, bidCode: string): Promise<void> => {
  const option = page
    .locator('[data-testid="payment-team"] option')
    .filter({ hasText: `(${bidCode})` });
  const value = await option.first().getAttribute("value");
  await page.getByTestId("payment-team").selectOption(value ?? "");
};

/** Fills the form and submits. A blank allocation is left blank, which is not the same as zero. */
const pay = async (
  page: Page,
  team: string,
  fields: { gross: string; rail?: string; fee?: string; ref?: string; allocate?: Record<string, string> },
): Promise<void> => {
  await pickTeam(page, team);
  await page.getByTestId("payment-rail").selectOption(fields.rail ?? "venmo");
  await page.getByTestId("payment-gross").fill(fields.gross);
  if (fields.fee) await page.getByTestId("payment-fee").fill(fields.fee);
  if (fields.ref) await page.getByTestId("payment-ref").fill(fields.ref);

  for (const [kind, amount] of Object.entries(fields.allocate ?? {})) {
    await page.getByTestId(`payment-allocation-${kind}`).fill(amount);
  }

  await page.getByTestId("payment-submit").click();
  await expect(page.getByTestId("payment-message")).toBeVisible();
};

const owedRow = (page: Page, bidCode: string) => page.getByTestId(`owes-row-${bidCode}`);

test("a board records a payment and the team reads settled", async ({ page }) => {
  const comp = seed();

  await accept(page, comp.boardToken, "M-1");
  await money(page, comp.boardToken);

  // 16 x $70 + 4 x $140 + $100 = $1,780, split across the three obligations it settles.
  await pay(page, "M-1", {
    gross: "1780.00",
    allocate: { registration: "1120.00", hotel: "560.00", deposit: "100.00" },
  });

  await expect(owedRow(page, "M-1")).toHaveAttribute("data-balance-cents", "0");

  await page.goto(`/board/${comp.boardToken}/roster`);
  await expect(page.getByTestId("roster-balance-M-1")).toHaveAttribute("data-balance-cents", "0");
});

test("a card fee is entered beside the gross, and the team is credited what arrived", async ({ page }) => {
  const comp = seed();

  await money(page, comp.boardToken);

  // BU Dheem's $100 deposit that landed as $97.01. The treasurer types gross and fee, because the
  // bank shows both; `net = gross - fee` is a CHECK, so a form that asked for net could disagree
  // with itself and be refused rather than quietly reconciled.
  await pay(page, "M-2", {
    gross: "100.00",
    rail: "card",
    fee: "2.99",
    allocate: { deposit: "100.00" },
  });

  await expect(page.getByTestId("payment-message")).toContainText("Recorded");

  // The obligation is settled by the gross: the processor's cut is the org's cost, not the team's.
  const row = owedRow(page, "M-2");
  await expect(row).toContainText("$100.00");
});

test("a lump larger than its allocations is recorded as a credit, and says so before submitting", async ({ page }) => {
  const comp = seed();

  await money(page, comp.boardToken);

  // NCSU's $2,160 against Beta's $1,600 of obligations. The readout is live, so the $560 that will
  // not attach is visible before the button is pressed rather than discovered after.
  await pickTeam(page, "M-2");
  await page.getByTestId("payment-gross").fill("2160.00");
  await page.getByTestId("payment-allocation-registration").fill("1400.00");
  await page.getByTestId("payment-allocation-hotel").fill("700.00");
  await expect(page.getByTestId("payment-unattached")).toHaveAttribute(
    "data-unattached-cents",
    "6000",
  );

  await page.getByTestId("payment-submit").click();
  await expect(page.getByTestId("payment-message")).toContainText("$60.00");
  await expect(page.getByTestId("payment-message")).toContainText("not attached");
});

test("allocations past the payment are refused in a sentence, never in SQL", async ({ page }) => {
  const comp = seed();

  await money(page, comp.boardToken);

  await pay(page, "M-2", {
    gross: "100.00",
    allocate: { registration: "1400.00" },
  });

  const message = page.getByTestId("payment-message");
  await expect(message).toContainText("more than the payment");
  // drizzle's own message is the failed SQL. A treasurer reconciling a bank statement must never
  // be shown it — that is why `refusal()` reads `error.cause.constraint` and not the text.
  await expect(message).not.toContainText("Failed query");
  await expect(message).not.toContainText("insert into");
});

test("more than a charge is worth is refused before it becomes a wrong label", async ({ page }) => {
  const comp = seed();

  await money(page, comp.boardToken);

  // $500 against a $100 deposit. The team-level balance would stay right — `paid` is gross-based —
  // so nothing downstream would ever notice; the refusal has to happen where the digit is typed.
  await pay(page, "M-2", {
    gross: "500.00",
    allocate: { deposit: "500.00" },
  });

  await expect(page.getByTestId("payment-message")).toContainText("left on that deposit charge");
});

test("an amount typed to a third decimal place is refused, not rounded", async ({ page }) => {
  const comp = seed();

  await money(page, comp.boardToken);
  await pay(page, "M-2", { gross: "100.005" });

  await expect(page.getByTestId("payment-message")).toContainText("dollars and cents");
});

test("the money screen is reachable by clicking, not by knowing the URL", async ({ page }) => {
  const comp = seed();

  // The defect this file exists for was half invisibility: A9 shipped and nothing linked to it, so
  // the only way in was to type the path. A screen a board cannot find is a screen it does not have.
  await page.goto(`/board/${comp.boardToken}`);
  await page.getByTestId("money-link").click();
  await expect(page.getByTestId("record-payment")).toBeVisible();

  await page.goto(`/board/${comp.boardToken}/roster`);
  await page.getByTestId("money-link").click();
  await expect(page.getByTestId("record-payment")).toBeVisible();
});

/**
 * The case worth the most in this file, run in the order it actually happens to a treasurer.
 *
 * NCSU sent one $2,160 Venmo labelled "hotel, security deposit & reg fees" — PRD §14's headline
 * exhibit — and a team paying to hold a slot pays *before* it is accepted, when
 * `BILLABLE_STATUSES` means it has no obligations to attach to. Until `allocatePayment` existed
 * that money could be recorded and then never attributed by any path, because `recordPayment`
 * fixed a payment's allocation set at insert.
 *
 * The load-bearing assertion is step 6: **attributing money must not move a balance.** `paid` is
 * the sum of gross, so saying what a payment was for is a statement about attribution and about
 * nothing else. If that number moves, the fix has reintroduced the bug it was written to close.
 */
test("a lump paid before acceptance is attributed after it, and attributing it moves no balance", async ({ page }) => {
  const comp = seed();

  await money(page, comp.boardToken);

  // 1. M-1 is `applied`. The money arrives with nothing to attach it to.
  await pay(page, "M-1", { gross: "2160.00", rail: "ach" });
  await expect(owedRow(page, "M-1")).toHaveAttribute("data-balance-cents", "-216000");
  await expect(page.getByTestId("unattributed-total")).toHaveText("$2,160.00");

  // 2. Accepting it generates $1,120 + $560 + $100. The balance moves; the money does not.
  await accept(page, comp.boardToken, "M-1");
  await money(page, comp.boardToken);
  await expect(owedRow(page, "M-1")).toHaveAttribute("data-balance-cents", "-38000");
  await expect(page.getByTestId("unattributed-total")).toHaveText("$2,160.00");

  // 3. Now it can be said what the lump was for.
  await page.getByTestId("apply-M-1-registration").fill("1120.00");
  await page.getByTestId("apply-M-1-hotel").fill("560.00");
  await page.getByTestId("apply-M-1-deposit").fill("100.00");
  await page.getByTestId("apply-submit-M-1").click();
  await expect(page.getByTestId("apply-message")).toContainText("$380.00");

  // 4. $380 of the lump remains unexplained, and the panel still says so.
  await expect(page.getByTestId("unattributed-total")).toHaveText("$380.00");

  // 5. Every obligation now reads settled -- the question A7's refund chain sits on top of.
  await expect(page.getByTestId("charge-M-1-deposit")).toHaveAttribute("data-paid-cents", "10000");
  await expect(page.getByTestId("charge-M-1-registration")).toHaveAttribute(
    "data-paid-cents",
    "112000",
  );

  // 6. And the balance did not move. This is the assertion the whole change is judged by.
  await expect(owedRow(page, "M-1")).toHaveAttribute("data-balance-cents", "-38000");
});

test("the same payment cannot be applied to the same charge twice", async ({ page }) => {
  const comp = seed();

  await money(page, comp.boardToken);

  // M-2 is accepted in the seed: 20 x $70 + 5 x $140 + $100 = $2,200.
  await pay(page, "M-2", { gross: "2200.00" });

  await page.getByTestId("apply-M-2-registration").fill("500.00");
  await page.getByTestId("apply-submit-M-2").click();
  await expect(page.getByTestId("apply-message")).toContainText("Applied");

  // $900 is still left on the $1,400 registration charge, so the in-process guard has nothing to
  // say -- what refuses this is `payment_allocations_live_unique`, read by constraint name.
  await page.getByTestId("apply-M-2-registration").fill("400.00");
  await page.getByTestId("apply-submit-M-2").click();

  const message = page.getByTestId("apply-message");
  await expect(message).toContainText("already applied to that charge");
  await expect(message).not.toContainText("Failed query");
});

test("another team's charge is refused, because a chargeId on a form is a claim", async ({ page }) => {
  const comp = seed();

  await accept(page, comp.boardToken, "M-1");
  await money(page, comp.boardToken);

  // Read M-2's registration chargeId out of the field name the form rendered for it...
  await pickTeam(page, "M-2");
  const stolen = await page.getByTestId("payment-allocation-registration").getAttribute("name");
  expect(stolen).toBeTruthy();

  // ...then post it against M-1, as a field the form never rendered. `charges.team_id` is a bare
  // FK, so the database would take this row happily; what refuses it is that the array the check
  // runs against came from the scoped read that produced the form, and holds only this team's live
  // charges — which is stronger than a WHERE clause and is why no fourth window was needed.
  await pickTeam(page, "M-1");
  await page.getByTestId("payment-gross").fill("100.00");
  await page.getByTestId("record-payment").evaluate((form, name) => {
    const forged = document.createElement("input");
    forged.type = "hidden";
    forged.name = name;
    forged.value = "100.00";
    form.appendChild(forged);
  }, stolen as string);
  await page.getByTestId("payment-submit").click();

  await expect(page.getByTestId("payment-message")).toContainText(
    "not one of this team's open obligations",
  );
});

test("a team with no charges can still be paid, because a deposit holds a slot", async ({ page }) => {
  const comp = seed();

  await money(page, comp.boardToken);

  // M-1 is `applied`, so `BILLABLE_STATUSES` means it has no live charges at all. Paying to hold a
  // slot before acceptance is the normal order of events, and a form that hid unbillable teams
  // would make that money unrecordable.
  await pay(page, "M-1", { gross: "100.00" });

  await expect(page.getByTestId("payment-message")).toContainText("Recorded");
  await expect(owedRow(page, "M-1")).toHaveAttribute("data-balance-cents", "-10000");
});

/**
 * Found by the obligation it settles rather than by id, because the id is only knowable from the
 * row the scoped read rendered — which is the whole point of resolving it through that read.
 */
const releaseButton = (page: Page, kind: string) =>
  page
    .locator('[data-testid^="allocation-"]')
    .filter({ hasText: kind })
    .getByRole("button", { name: "release" });

/**
 * The undo for a wrong label, and the reason it had to be built: `releaseAllocation` shipped
 * complete, transactional and audited with **no caller anywhere in the repo**, so a treasurer who
 * mis-typed an allocation could not take it back. `payment_allocations_live_unique` refuses the
 * corrected attempt — the test above proves it — and the only escape was a roster move that voided
 * the whole charge.
 *
 * The load-bearing assertion is the last one, and it is the same one the lump test turns on from
 * the other direction: **releasing must not move a balance.** `paid` is the sum of gross, so
 * detaching money says something about attribution and nothing about whether it arrived. If that
 * number moves, this has reintroduced the bug the whole module is built against.
 */
test("a mis-typed allocation is released, and the money reads unattached rather than gone", async ({ page }) => {
  const comp = seed();

  await money(page, comp.boardToken);

  // M-2 is accepted in the seed: 20 x $70 + 5 x $140 + $100 = $2,200. The board pays it in full,
  // but puts the hotel's $700 on the deposit -- the realistic slip, since both are "the extras".
  await pay(page, "M-2", { gross: "2200.00", allocate: { registration: "1400.00", deposit: "100.00" } });
  await expect(owedRow(page, "M-2")).toHaveAttribute("data-balance-cents", "0");

  await releaseButton(page, "registration").click();
  await expect(page.getByTestId("release-message")).toContainText("$1,400.00");

  // The charge is unsettled again...
  await expect(page.getByTestId("charge-M-2-registration")).toHaveAttribute("data-paid-cents", "0");

  // ...the money is offered back as credit to re-attribute...
  await expect(page.getByTestId("unattributed-total")).toHaveText("$2,100.00");

  // ...and the balance has not moved, because the $2,200 is still in the org's account.
  await expect(owedRow(page, "M-2")).toHaveAttribute("data-balance-cents", "0");

  // And the correction the unique index refused before now goes through.
  await page.getByTestId("apply-M-2-hotel").fill("700.00");
  await page.getByTestId("apply-M-2-registration").fill("1400.00");
  await page.getByTestId("apply-submit-M-2").click();
  await expect(page.getByTestId("charge-M-2-hotel")).toHaveAttribute("data-paid-cents", "70000");
});

test("a released allocation is not offered twice, and the counter does not move twice", async ({ page }) => {
  const comp = seed();

  await money(page, comp.boardToken);
  await pay(page, "M-2", { gross: "2200.00", allocate: { deposit: "100.00" } });

  const release = releaseButton(page, "deposit");
  const id = await release.getAttribute("data-testid");
  expect(id).toBeTruthy();

  await release.click();
  await expect(page.getByTestId("release-message")).toContainText("$100.00");

  // The row is gone from the screen, which is the ordinary half. The half that matters is that the
  // id it carried is refused if it comes back -- a double-click subtracting the same cents twice
  // would leave `allocated_cents` under the sum it stands for, which is the drift `db:doctor`
  // reports and nobody can resolve after the fact.
  await expect(page.getByTestId(id as string)).toHaveCount(0);
  await expect(page.getByTestId("unattributed-total")).toHaveText("$2,200.00");
});
