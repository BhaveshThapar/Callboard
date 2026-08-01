import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * A2's other half: a roster move and the obligations it implies land together, or neither does.
 *
 * The unit tests prove `planCharges` is idempotent and `teamBalance` is right, but neither can see
 * the thing that actually breaks — that `setTeamStatus` opens one transaction and does *both* halves
 * inside it. Half of it is an accepted team owing nothing, which is the orphan A3 exists to prevent
 * and the one a treasurer finds in March rather than one we find in September.
 *
 * The case worth the whole file is the last one: a team that paid, dropped, and came back reads
 * **paid, not owing**. Every hand-run system gets that wrong, because the natural implementation
 * deletes the charges and loses the record of what the money was for.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "money-e2e-org";
const COMP = "money-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

/** $70/dancer + $140/room + $100 deposit — Mayuri's real schedule, so the numbers are checkable. */
const CONFIG = {
  org: { name: "Money E2E Org", slug: ORG },
  comp: { name: "Money E2E 2027", slug: COMP, compDate: "2027-03-06", status: "open" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [
    { name: "Applied Alpha", bidCode: "M-1", status: "applied", rosterSize: 16, rooms: 4 },
    { name: "Accepted Beta", bidCode: "M-2", status: "accepted", rosterSize: 20, rooms: 5 },
    { name: "No Rooms Gamma", bidCode: "M-3", status: "applied", rosterSize: 10 },
    { name: "Waitlist One", bidCode: "W-1", status: "waitlisted", waitlistRank: 1, rosterSize: 12, rooms: 3 },
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
  const config = tmp("money.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const boardPage = async (browser: Browser, token: string): Promise<Page> => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/board/${token}/roster`);
  await expect(page.getByTestId("roster")).toBeVisible();
  return page;
};

const roster = async (page: Page, token: string): Promise<void> => {
  await page.goto(`/board/${token}/roster`);
  await expect(page.getByTestId("roster")).toBeVisible();
};

const move = async (page: Page, bidCode: string, to: string): Promise<void> => {
  const row = page.getByTestId(`roster-row-${bidCode}`);
  await row.getByRole("button", { name: to, exact: true }).click();
  await expect(row).toHaveAttribute("data-status", to);
};

const balanceCents = async (page: Page, bidCode: string): Promise<number | null> => {
  const cell = page.getByTestId(`roster-balance-${bidCode}`);
  if ((await cell.count()) === 0) return null;
  return Number(await cell.getAttribute("data-balance-cents"));
};

test("accepting a team generates what the schedule says it owes, in the same act", async ({ browser }) => {
  const comp = seed();
  const page = await boardPage(browser, comp.boardToken);

  // Applied teams are not billable, so there is no balance cell at all -- not a $0 one.
  expect(await balanceCents(page, "M-1")).toBeNull();

  await move(page, "M-1", "accepted");

  // 16 dancers x $70 + 4 rooms x $140 + $100 deposit = $1,780.
  expect(await balanceCents(page, "M-1")).toBe(178_000);
});

test("a team whose rooms are unknown is billed for everything except the room it cannot be billed for", async ({ browser }) => {
  const comp = seed();
  const page = await boardPage(browser, comp.boardToken);

  await move(page, "M-3", "accepted");

  // 10 dancers x $70 + $100 deposit. No hotel line at all, because a $0 one would read as settled.
  expect(await balanceCents(page, "M-3")).toBe(80_000);
});

test("moving accepted to competing regenerates nothing", async ({ browser }) => {
  const comp = seed();
  const page = await boardPage(browser, comp.boardToken);

  const before = await balanceCents(page, "M-2");
  expect(before).toBe(20 * 7000 + 5 * 14_000 + 10_000);

  await move(page, "M-2", "competing");

  // Same identity `(teamId, kind)`, same schedule -> `planCharges` returns nothing to do. A second
  // set of charges here would double every team's bill on a status change nobody thinks about.
  expect(await balanceCents(page, "M-2")).toBe(before);
});

test("dropping a team voids what it owed, and promotes the waitlist with its own charges", async ({ browser }) => {
  const comp = seed();
  const page = await boardPage(browser, comp.boardToken);

  await move(page, "M-2", "dropped");

  // The obligation does not outlive the team holding it.
  expect(await balanceCents(page, "M-2")).toBeNull();

  // The promotion and the promoted team's bill landed in the same transaction as the drop.
  const promoted = page.getByTestId("roster-row-W-1");
  await expect(promoted).toHaveAttribute("data-status", "accepted");
  expect(await balanceCents(page, "W-1")).toBe(12 * 7000 + 3 * 14_000 + 10_000);
});

/**
 * The one every hand-run system gets wrong. The natural implementation deletes a dropped team's
 * charges, which destroys the record of what its money was for — so on reinstatement the team is
 * billed again for something it already paid, and the only trace is in somebody's Venmo history.
 *
 * Here the charges are *voided*, the allocations survive, and `charges_live_kind_unique` is partial
 * on `voided_at is null` so the regenerate is not blocked by the rows it is replacing.
 */
test("a team that paid, dropped, and came back reads paid rather than owing", async ({ browser }) => {
  const comp = seed();
  const page = await boardPage(browser, comp.boardToken);

  const owed = await balanceCents(page, "M-2");
  expect(owed).toBeGreaterThan(0);

  // Pay it off in full, directly — the payment UI is A9 and this test is about reconciliation.
  execFileSync(
    "bunx",
    ["tsx", "e2e/support/pay.ts", comp.compId, "M-2", String(owed)],
    { stdio: "pipe" },
  );

  await roster(page, comp.boardToken);
  expect(await balanceCents(page, "M-2")).toBe(0);

  await move(page, "M-2", "dropped");
  await move(page, "M-2", "accepted");

  // Charges regenerated at the same amounts; the old allocations still count. Owing zero, not
  // owing the whole bill again.
  expect(await balanceCents(page, "M-2")).toBe(0);
});

/**
 * A9. The totals row is the one number a board carries into a meeting without re-deriving it, so it
 * is asserted against the sum of the rows above it rather than against a constant — a summary that
 * disagrees with its own rows is the ~$5,000 gap in miniature, arrived at honestly.
 */
test("the who-owes screen totals exactly the rows it shows", async ({ browser }) => {
  const comp = seed();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto(`/board/${comp.boardToken}/money`);
  await expect(page.getByTestId("who-owes")).toBeVisible();

  const rowTotal = await page
    .locator("[data-testid^='owes-row-']")
    .evaluateAll((rows) =>
      rows.reduce((sum, row) => sum + Number(row.getAttribute("data-balance-cents")), 0),
    );

  const shown = Number(
    await page.getByTestId("who-owes-total").getAttribute("data-balance-cents"),
  );

  expect(shown).toBe(rowTotal);
  // The seeded comp has one accepted team owing its full bill, so this is not a vacuous zero.
  expect(rowTotal).toBeGreaterThan(0);
});

test("a comp that bills nothing says so rather than showing an empty table", async ({ browser }) => {
  const noFees = { ...CONFIG, org: { name: "No Fees Org", slug: "nofee-e2e-org" }, comp: { ...CONFIG.comp, slug: "nofee-e2e-comp" } };
  delete (noFees as { feeSchedule?: unknown }).feeSchedule;

  const config = tmp("nofee.json");
  writeFileSync(config, JSON.stringify(noFees));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  const comp = JSON.parse(readFileSync(out, "utf8")) as SeededComp;

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/board/${comp.boardToken}/money`);

  await expect(page.getByText("No team has been billed yet")).toBeVisible();
  await expect(page.getByTestId("who-owes")).toHaveCount(0);
});

test("the who-owes CSV carries the same total the screen does", async ({ browser }) => {
  const comp = seed();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto(`/board/${comp.boardToken}/money`);
  const shown = Number(
    await page.getByTestId("who-owes-total").getAttribute("data-balance-cents"),
  );

  const csv = await (await page.request.get(`/board/${comp.boardToken}/money/export`)).text();
  const total = csv.split("\r\n").at(-1) ?? "";

  expect(total).toContain("TOTAL");
  // Dollars in the file, cents on the screen: the same number, formatted once, in one place.
  const dollars = (shown / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  expect(total).toContain(dollars);
});
