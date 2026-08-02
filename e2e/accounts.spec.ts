import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

/**
 * P1 end to end: a board invites somebody who does not have an account, and that person signs in.
 *
 * This is the journey ADR-0011 said the product could not do — *"a board member is added mid-week:
 * they get someone else's link, or they get nothing"* — and it is the one every remaining
 * person-facing feature is built on top of, so it is worth driving through a browser rather than
 * asserting about functions.
 *
 * The link is read out of the board's own screen rather than the database, because being *shown*
 * once is the whole contract: nothing in the product can recover it afterwards.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "accounts-e2e-org";
const COMP = "accounts-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Accounts E2E Org", slug: ORG },
  comp: { name: "Accounts E2E 2027", slug: COMP, compDate: "2027-03-06", status: "open" },
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
  board: [{ name: "Accounts Chair" }],
  feeSchedule: {
    perDancerCents: 7000,
    perRoomCents: 14000,
    depositCents: 10000,
    lateFeeCents: 2500,
    lateAfter: "2099-01-01",
  },
};

const seed = (): SeededComp => {
  const config = tmp("accounts.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const PASSWORD = "a passphrase long enough to pass";

/** Invites somebody from the board's People screen and returns the link it showed exactly once. */
const inviteFrom = async (
  page: Page,
  token: string,
  fields: { name: string; email: string; role: string; team?: string },
): Promise<string> => {
  await page.goto(`/board/${token}/people`);
  await expect(page.getByTestId("invite-panel")).toBeVisible();

  await page.getByTestId("invite-name").fill(fields.name);
  await page.getByTestId("invite-email").fill(fields.email);
  await page.getByTestId("invite-role").selectOption(fields.role);
  if (fields.team) {
    const option = page.locator('[data-testid="invite-team"] option').filter({ hasText: fields.team });
    await page.getByTestId("invite-team").selectOption((await option.first().getAttribute("value")) ?? "");
  }
  await page.getByTestId("invite-submit").click();

  const message = page.getByTestId("invite-message");
  await expect(message).toBeVisible();
  const text = (await message.textContent()) ?? "";
  const match = text.match(/\/invite\/([\w-]+)/);
  expect(match, `no invitation link in: ${text}`).toBeTruthy();
  return `/invite/${match?.[1]}`;
};

test("a board invites a captain who has no account, and the captain signs in", async ({ page }) => {
  const comp = seed();

  const link = await inviteFrom(page, comp.boardToken, {
    name: "Nisha Patel",
    email: "nisha@example.com",
    role: "captain",
    team: "Accepted Beta",
  });

  // The invitation names who it is for before it is accepted, so the address is shown and fixed.
  await page.goto(link);
  await expect(page.getByTestId("credential-email")).toHaveValue("nisha@example.com");
  await expect(page.getByTestId("credential-email")).toHaveAttribute("readonly", "");

  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();
  await expect(page).toHaveURL(/\/$/);

  // And the board can see that it landed.
  await page.goto(`/board/${comp.boardToken}/people`);
  await expect(page.getByTestId("invitee-nisha@example.com")).toHaveAttribute(
    "data-accepted",
    "true",
  );
});

/**
 * An invitation is spent exactly once, and the second attempt is refused with a sentence rather than
 * a stack trace. This is the guarded update inside `acceptInvitation` doing its job — the read and
 * the write are two acts, so the database is what actually refuses.
 */
test("an invitation cannot be used twice", async ({ page, browser }) => {
  const comp = seed();

  const link = await inviteFrom(page, comp.boardToken, {
    name: "Dev Shah",
    email: "dev@example.com",
    role: "liaison",
  });

  await page.goto(link);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();
  await expect(page).toHaveURL(/\/$/);

  // A second person opening the same link -- a forwarded email, a shared screenshot.
  const other = await browser.newPage();
  await other.goto(link);
  // The accept screen is gone entirely: a spent invitation reads exactly like one that never was.
  await expect(other.getByTestId("credential-form")).toHaveCount(0);
  await other.close();
});

test("re-inviting somebody supersedes the first envelope rather than leaving two live", async ({
  page,
}) => {
  const comp = seed();

  const first = await inviteFrom(page, comp.boardToken, {
    name: "Ravi Kumar",
    email: "ravi@example.com",
    role: "board",
  });
  const second = await inviteFrom(page, comp.boardToken, {
    name: "Ravi Kumar",
    email: "ravi@example.com",
    role: "board",
  });
  expect(second).not.toBe(first);

  // The first is dead the moment the second is minted -- `invitations_live_unique` is partial over
  // the unspent rows, so there is never a moment with two valid envelopes addressed to one person.
  await page.goto(first);
  await expect(page.getByTestId("credential-form")).toHaveCount(0);

  await page.goto(second);
  await expect(page.getByTestId("credential-form")).toBeVisible();
});

/**
 * The wording half of the oracle. `burnPasswordTime` closes the timing half, which a browser test
 * cannot see; this asserts that an unknown email and a wrong password read identically, because the
 * emails on this product are a board roster and who is on it is worth something.
 */
test("a failed sign-in never says which half was wrong", async ({ page }) => {
  const comp = seed();

  const link = await inviteFrom(page, comp.boardToken, {
    name: "Asha Rao",
    email: "asha@example.com",
    role: "liaison",
  });
  await page.goto(link);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();
  await expect(page).toHaveURL(/\/$/);

  const attempt = async (email: string, password: string): Promise<string> => {
    await page.goto("/sign-in");
    await page.getByTestId("credential-email").fill(email);
    await page.getByTestId("credential-password").fill(password);
    await page.getByTestId("credential-submit").click();
    await expect(page.getByTestId("credential-message")).toBeVisible();
    return (await page.getByTestId("credential-message").textContent()) ?? "";
  };

  const unknown = await attempt("nobody@example.com", PASSWORD);
  const wrong = await attempt("asha@example.com", "the wrong passphrase entirely");

  expect(unknown).toBe(wrong);
  expect(unknown).not.toMatch(/no such|not found|unknown|incorrect password/i);
});

test("a captain is invited for a team, and nobody else is", async ({ page }) => {
  const comp = seed();

  await page.goto(`/board/${comp.boardToken}/people`);
  // The team picker is disabled unless the role needs one, which is the CHECK on `memberships`
  // showing up in the form rather than being discovered by a failed insert.
  await page.getByTestId("invite-role").selectOption("liaison");
  await expect(page.getByTestId("invite-team")).toBeDisabled();

  await page.getByTestId("invite-role").selectOption("captain");
  await expect(page.getByTestId("invite-team")).toBeEnabled();
});

/**
 * The fourth window, driven through a browser: a captain sees their own team and nothing else.
 *
 * The page holds no `teamId` and takes none from the URL — the comp is in the path and the team
 * comes off the actor's membership — so there is no id here to swap for somebody else's. That is
 * exactly why `ownTeamForCaptain` was allowed to be a fourth window at all, and it is worth a test
 * that proves the shape rather than trusting the argument.
 */
test("a captain sees their own team's money and no other team", async ({ page }) => {
  const comp = seed();

  const link = await inviteFrom(page, comp.boardToken, {
    name: "Meera Iyer",
    email: "meera@example.com",
    role: "captain",
    team: "Accepted Beta",
  });

  await page.goto(link);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();

  // Accepting lands somewhere that goes somewhere -- the journey does not end on a marketing page.
  await expect(page.getByTestId("my-comps")).toBeVisible();
  await page.getByTestId(`my-comp-${COMP}`).click();

  // M-2 is accepted in the seed: 20 x $70 + 5 x $140 + $100 = $2,200, all unpaid.
  await expect(page.getByTestId("my-team")).toBeVisible();
  await expect(page.getByTestId("my-balance")).toHaveAttribute("data-balance-cents", "220000");
  await expect(page.getByTestId("my-charge-registration")).toBeVisible();

  // Their own team, and the other one is nowhere on the page.
  await expect(page.getByText("Accepted Beta")).toBeVisible();
  await expect(page.getByText("Accepted Gamma")).toHaveCount(0);
  await expect(page.getByText("M-3")).toHaveCount(0);
});

test("a captain's session is not authority at a comp they are not in", async ({ page }) => {
  const comp = seed();

  const link = await inviteFrom(page, comp.boardToken, {
    name: "Sana Khan",
    email: "sana@example.com",
    role: "captain",
    team: "Accepted Beta",
  });
  await page.goto(link);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();
  await expect(page.getByTestId("my-comps")).toBeVisible();

  // A perfectly valid session, pointed at a comp the membership does not name. Two lookups rather
  // than one is what makes this a 404 instead of a view of somebody else's comp.
  const response = await page.goto(`/my/${crypto.randomUUID()}`);
  expect(response?.status()).toBe(404);
});

test("signing out kills the session rather than only the cookie", async ({ page }) => {
  const comp = seed();

  const link = await inviteFrom(page, comp.boardToken, {
    name: "Kiran Das",
    email: "kiran@example.com",
    role: "captain",
    team: "Accepted Beta",
  });
  await page.goto(link);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();
  await expect(page.getByTestId("my-comps")).toBeVisible();

  const cookie = (await page.context().cookies()).find((c) => c.name === "callboard_session");
  expect(cookie?.value).toBeTruthy();

  await page.getByTestId("sign-out").first().click();
  await expect(page).toHaveURL(/\/sign-in/);

  // Putting the cookie back proves the row is what died, not the browser's copy of it. A JWT could
  // not have given us this, which is the whole reason a session is a row (ADR-0016).
  await page.context().addCookies([{ ...cookie!, value: cookie!.value }]);
  await page.goto("/");
  await expect(page.getByTestId("my-comps")).toHaveCount(0);
});
