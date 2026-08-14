import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

/**
 * A4's materials half, end to end.
 *
 * The half that needed driving through a browser is not "does the form save" -- it is **that a
 * captain cannot move their own balance**. `roster_size` is what `planCharges` bills on, so a
 * captain who could write it could write their own invoice, downward, with nobody told. The claim
 * lands in `roster_size_requested`, and only the board's `setTeamBilling` turns it into money.
 *
 * So the assertions worth having are a *pair*: the balance does not move when the captain files,
 * and it does move when the board applies. Either one alone passes for the wrong reason.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "materials-e2e-org";
const COMP = "materials-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Materials E2E Org", slug: ORG },
  comp: { name: "Materials E2E 2027", slug: COMP, compDate: "2027-03-06", status: "open" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [
    { name: "Filing Beta", bidCode: "M-2", status: "accepted", rosterSize: 20, rooms: 5 },
    { name: "Quiet Gamma", bidCode: "M-3", status: "accepted", rosterSize: 12, rooms: 3 },
  ],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Materials Chair" }],
  feeSchedule: {
    perDancerCents: 7000,
    perRoomCents: 14000,
    depositCents: 10000,
    lateFeeCents: 2500,
    lateAfter: "2099-01-01",
  },
};

const seed = (): SeededComp => {
  const config = tmp("materials.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const PASSWORD = "a passphrase long enough to pass";

/** M-2 as seeded: 20 x $70 + 5 x $140 + $100 deposit. */
const BILLED_AT_20 = "220000";
/** The same team once the board grants a request for 18: 18 x $70 + 5 x $140 + $100. */
const BILLED_AT_18 = "206000";

/** Invites a captain from the board's screen and signs them in, landing on their own team page. */
const captainFor = async (page: Page, token: string, team: string, email: string): Promise<void> => {
  await page.goto(`/board/${token}/people`);
  await expect(page.getByTestId("invite-panel")).toBeVisible();
  await page.getByTestId("invite-name").fill("A Captain");
  await page.getByTestId("invite-email").fill(email);
  await page.getByTestId("invite-role").selectOption("captain");
  const option = page.locator('[data-testid="invite-team"] option').filter({ hasText: team });
  await page
    .getByTestId("invite-team")
    .selectOption((await option.first().getAttribute("value")) ?? "");
  await page.getByTestId("invite-submit").click();

  const text = (await page.getByTestId("invite-message").textContent()) ?? "";
  const match = text.match(/\/invite\/([\w-]+)/);
  expect(match, `no invitation link in: ${text}`).toBeTruthy();

  await page.goto(`/invite/${match?.[1]}`);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();
  await expect(page).toHaveURL(/\/app$/);
  await page.getByTestId(`my-comp-${COMP}`).click();
  await expect(page.getByTestId("my-team")).toBeVisible();
};

test("a captain files materials, and cannot move their own balance doing it", async ({
  page,
  browser,
}) => {
  const comp = seed();
  await captainFor(page, comp.boardToken, "Filing Beta", "beta@example.com");

  await expect(page.getByTestId("my-balance")).toHaveAttribute("data-balance-cents", BILLED_AT_20);

  await page.getByTestId("materials-music").fill("https://drive.example.com/final-mix.wav");
  await page.getByTestId("materials-contact-name").fill("Priya Raghavan");
  await page.getByTestId("materials-contact-phone").fill("+1 555 0100");
  await page.getByTestId("materials-dancers").fill("18");
  await page.getByTestId("materials-submit").click();

  // The wording is the product: it says out loud that the number is not yet what they owe.
  await expect(page.getByTestId("materials-message")).toContainText("board has to confirm");

  // And the balance has not moved. This is the assertion the whole design exists for.
  await page.reload();
  await expect(page.getByTestId("my-balance")).toHaveAttribute("data-balance-cents", BILLED_AT_20);

  // The board sees the filing, and sees the claim as a claim.
  const board = await browser.newPage();
  await board.goto(`/board/${comp.boardToken}/roster`);
  await expect(board.getByTestId("roster-music-M-2")).toBeVisible();
  await expect(board.getByTestId("roster-ice-M-2")).toContainText("Priya Raghavan");
  await expect(board.getByTestId("billing-requested-M-2")).toHaveAttribute("data-requested", "18");

  // Applying it is the board stating the roster, which is the only act that bills.
  await board.getByTestId("billing-apply-M-2").click();
  await expect(board.getByTestId("roster-balance-M-2")).toHaveAttribute(
    "data-balance-cents",
    BILLED_AT_18,
  );
  // The claim is answered, so it stops asking.
  await expect(board.getByTestId("billing-requested-M-2")).toHaveCount(0);
  await board.close();

  await page.reload();
  await expect(page.getByTestId("my-balance")).toHaveAttribute("data-balance-cents", BILLED_AT_18);
});

/**
 * The music link is the one string a captain writes that a board member later clicks, so the scheme
 * is refused at the door rather than sanitized at render. `putMaterial` parses rather than
 * pattern-matches; this is that decision reaching a person.
 */
test("a music link that is not http(s) is refused with a sentence", async ({ page }) => {
  const comp = seed();
  await captainFor(page, comp.boardToken, "Filing Beta", "hostile@example.com");

  await page.getByTestId("materials-music").fill("javascript:alert(1)");
  await page.getByTestId("materials-submit").click();

  await expect(page.getByTestId("materials-message")).toContainText("http or https");
  await page.reload();
  await expect(page.getByTestId("materials-music")).toHaveValue("");
});

/**
 * The fourth window still holds with a write behind it. A captain filing materials must not become
 * a captain who can read, or write, another team's -- and the form carries no `teamId` at all, so
 * there is nothing here to swap.
 */
test("filing materials reaches one team and no other", async ({ page, browser }) => {
  const comp = seed();
  await captainFor(page, comp.boardToken, "Filing Beta", "beta2@example.com");

  await page.getByTestId("materials-contact-name").fill("Beta Contact Only");
  await page.getByTestId("materials-submit").click();
  await expect(page.getByTestId("materials-message")).toContainText("Filed");

  const board = await browser.newPage();
  await board.goto(`/board/${comp.boardToken}/roster`);
  await expect(board.getByTestId("roster-ice-M-2")).toContainText("Beta Contact Only");
  // The other accepted team filed nothing, and reads as never having filed rather than as blank.
  await expect(board.getByTestId("roster-materials-M-3")).toHaveCount(0);
  await board.close();

  // Nothing about the other team is on the captain's page, materials included.
  await expect(page.getByText("Quiet Gamma")).toHaveCount(0);
  await expect(page.getByText("M-3")).toHaveCount(0);
});
