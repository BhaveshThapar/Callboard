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

const comms = (...args: string[]): string =>
  execFileSync("bunx", ["tsx", "e2e/support/comms.ts", ...args], { encoding: "utf8" }).trim();

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
  await expect(page).toHaveURL(/\/app$/);

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
    role: "board",
  });

  await page.goto(link);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();
  await expect(page).toHaveURL(/\/app$/);

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
    role: "board",
  });
  await page.goto(link);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();
  await expect(page).toHaveURL(/\/app$/);

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
  await page.getByTestId("invite-role").selectOption("board");
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

/**
 * A board member who accepts an invitation has to land somewhere that is not a lie.
 *
 * The landing page linked all three roles at `/my/[comp]`, which resolves a `captain` membership by
 * name — so a board member signed in, saw their own comp, clicked it, and was told it did not exist.
 * That is the "code with no caller" defect wearing a URL, and it shipped inside the commit that
 * added the comment claiming the opposite.
 */
test("a board member signs in and is told where their way in actually is", async ({ page }) => {
  const comp = seed();

  const link = await inviteFrom(page, comp.boardToken, {
    name: "Ravi Menon",
    email: "ravi@example.com",
    role: "board",
  });

  await page.goto(link);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();

  // Their comp is named, and it *opens* — which is what ADR-0022 changed. This assertion used to
  // read "emailed to you", because a signed-in board member had an account that authorized nothing
  // and the honest thing was to say so. Now the same session resolves a `BoardActor`.
  await expect(page.getByTestId("my-comps")).toBeVisible();
  await page.getByTestId(`my-comp-${COMP}`).click();
  await expect(page).toHaveURL(new RegExp(`/app/[^/]+/${COMP}$`));
  await expect(page.getByTestId("comp-name")).toBeVisible();

  // Signed in, so the shell offers a way out — a board *link* has nothing to sign out of, and the
  // header says which of the two you are holding rather than pretending they are the same.
  await expect(page.getByTestId("sign-out")).toBeVisible();
  await expect(page.getByTestId("via-link")).toHaveCount(0);

  // Every board screen, by session alone. No token was ever in this browser.
  for (const section of ["roster", "money", "people"]) {
    const response = await page.goto(`/app/${ORG}/${COMP}/${section}`);
    expect(response?.status(), section).toBe(200);
  }

  // And the old captain URL still answers, because it went out in email. It redirects rather than
  // 404ing; this board member is not a captain, so the team page sends them back to the dashboard.
  await page.goto(`/my/${comp.compId}`);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("my-comps")).toBeVisible();
});

/**
 * A board can take somebody back off, which for three weeks it could not: `memberships.revoked_at`
 * was read by every membership filter and written by nothing, so P1 shipped a way to add a person
 * and no way to remove one — in a product whose two prior credential decisions are both about
 * killing a credential (ADR-0011) and about being able to (ADR-0016).
 *
 * The session is deliberately still valid; what dies is the membership. That is the two-lookup
 * design paying out, and asserting it here is what keeps somebody from "fixing" it by nuking
 * sessions and signing a captain out of a comp this board has no say over.
 */
test("a board removes a captain, and the captain's own page stops resolving", async ({ page }) => {
  const comp = seed();

  const link = await inviteFrom(page, comp.boardToken, {
    name: "Devi Rao",
    email: "devi@example.com",
    role: "captain",
    team: "Accepted Beta",
  });
  await page.goto(link);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();
  await expect(page.getByTestId("my-comps")).toBeVisible();

  await page.goto(`/my/${comp.compId}`);
  await expect(page.getByTestId("my-team")).toBeVisible();

  // The board removes them, from the screen rather than from the database.
  const board = await page.context().newPage();
  await board.goto(`/board/${comp.boardToken}/people`);
  await expect(board.getByTestId("invitee-devi@example.com")).toHaveAttribute(
    "data-has-access",
    "true",
  );
  await board.getByTestId("revoke-devi@example.com").click();
  await expect(board.getByTestId("revoke-message")).toContainText(/no longer open this comp/i);
  await expect(board.getByTestId("invitee-devi@example.com")).toHaveAttribute(
    "data-has-access",
    "false",
  );

  // Same cookie, next request: the membership is what died, so the comp is gone from their landing
  // page and their team's page refuses them.
  await page.goto("/");
  await expect(page.getByTestId(`my-comp-${COMP}`)).toHaveCount(0);

  const response = await page.goto(`/my/${comp.compId}`);
  expect(response?.status()).toBe(404);
  await board.close();
});

/**
 * A role with no screen behind it cannot be handed out — and the refusal is the rule, not the
 * markup. `validateAnswers`' reason: the `<select>` no longer offers `liaison`, and a hand-crafted
 * POST that names it anyway is refused by the same list the form was built from.
 */
test("a liaison cannot be invited, because there is nothing for one to open", async ({ page }) => {
  const comp = seed();

  await page.goto(`/board/${comp.boardToken}/people`);
  await expect(page.locator('[data-testid="invite-role"] option[value="liaison"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="invite-role"] option[value="board"]')).toHaveCount(1);

  await page.getByTestId("invite-name").fill("Lia Sonn");
  await page.getByTestId("invite-email").fill("lia@example.com");

  // Put the option back and submit it, the way `custom-fields.spec.ts` strips `required` before
  // submitting: the form is a courtesy to an honest board, and the server is the rule.
  await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>('[data-testid="invite-role"]');
    if (!select) throw new Error("no role select on the page");
    const option = document.createElement("option");
    option.value = "liaison";
    select.append(option);
    select.value = "liaison";
  });
  await page.getByTestId("invite-submit").click();

  const message = page.getByTestId("invite-message");
  await expect(message).toBeVisible();
  await expect(message).not.toContainText("/invite/");

  // The refusal is a sentence, and no envelope was minted behind it.
  await page.reload();
  await expect(page.getByTestId("invitee-lia@example.com")).toHaveCount(0);
});

/**
 * The invitation sends itself now, and **the link is still on the screen** — which is the part worth
 * a test rather than the part that is obvious.
 *
 * Only the sha256 of the token is stored, so nothing can recover this link once the tab is closed,
 * and sending is opt-in on two environment variables that CI does not set. A screen that said
 * "emailed" here would be telling a board to close a tab that is holding the only copy of a
 * credential nobody received.
 */
test("an invitation is queued as email, and the link is shown anyway", async ({ page }) => {
  const comp = seed();

  const link = await inviteFrom(page, comp.boardToken, {
    name: "Tara Bhatt",
    email: "tara@example.com",
    role: "captain",
    team: "Accepted Beta",
  });

  // The screen still carries the link, and says plainly that nothing was sent from here.
  const message = page.getByTestId("invite-message");
  await expect(message).toContainText("/invite/");
  await expect(message).toContainText("sending is not configured");

  // And the outbox holds exactly one invitation, addressed to the person it names.
  expect(comms("count", COMP)).toBe("1");
  expect(comms("recipients", COMP)).toContain("invitation.created tara@example.com");

  // The queued link is the one that works, not merely a link-shaped string.
  await page.goto(link);
  await expect(page.getByTestId("credential-email")).toHaveValue("tara@example.com");
});

/**
 * ADR-0021 — the outbox holds the credential only until it sends it.
 *
 * ADR-0003's rule is that only the sha256 is stored, and emailing a link cannot honour it: the
 * outbox has to hold the thing it is going to send. So the window is closed at the other end, and
 * this is the assertion that says the closing actually happens — nothing downstream would notice a
 * payload that quietly kept its token, which is precisely why it needs a test.
 */
test("a sent invitation stops carrying its own link", async ({ page }) => {
  const comp = seed();

  const link = await inviteFrom(page, comp.boardToken, {
    name: "Uma Nair",
    email: "uma@example.com",
    role: "captain",
    team: "Accepted Beta",
  });
  const token = link.split("/invite/")[1] ?? "";
  expect(token).not.toBe("");

  // Queued, and holding the link, because that is the whole reason the payload exists.
  expect(comms("payload", COMP, "uma@example.com")).toContain(token);

  expect(comms("sweep", COMP)).toBe("1 1 0 0");

  // Sent, and no longer holding it. The key stays, so a replay a season later renders a sentence
  // that says what happened rather than `undefined`.
  const after = comms("payload", COMP, "uma@example.com");
  expect(after).not.toContain(token);
  expect(after).toContain("(link removed after sending)");

  // And the credential itself still works — the scrub took the copy, not the invitation.
  await page.goto(link);
  await expect(page.getByTestId("credential-email")).toHaveValue("uma@example.com");
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
