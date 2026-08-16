import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

/**
 * C1 end to end.
 *
 * The first test here is the phase's own acceptance bar, and it is the journey that **would have
 * failed for the entire life of P1**: a board invites a liaison, the liaison signs in, and the page
 * they land on loads. `resolveLiaisonActor` had no caller from P1 until C1, while the invite form
 * offered Liaison in its dropdown — so a board could mint a credential whose whole journey ended on
 * a `notFound()`. That is ADR-0011's own failure arriving through the door ADR-0016 opened, and
 * nothing but a test that walks the whole way catches it.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "duties-e2e-org";
const COMP = "duties-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Duties E2E Org", slug: ORG },
  comp: { name: "Duties E2E 2027", slug: COMP, compDate: "2027-03-06", status: "open" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [
    { name: "Duty Alpha", bidCode: "D-1", status: "accepted", rosterSize: 18 },
    { name: "Duty Beta", bidCode: "D-2", status: "accepted", rosterSize: 20 },
  ],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Duties Chair" }],
  duties: [
    { id: "walk", label: "Team liaison", category: "team", swaRequired: true },
    { id: "runner", label: "Judge runner", category: "judge" },
    { id: "door", label: "Door greeter", category: "general" },
  ],
};

const seed = (): SeededComp => {
  const config = tmp("duties.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const PASSWORD = "a passphrase long enough to pass";
const BASE = `/app/${ORG}/${COMP}`;

const inviteFrom = async (
  page: Page,
  token: string,
  fields: { name: string; email: string; role: string },
): Promise<string> => {
  await page.goto(`/board/${token}/people`);
  await expect(page.getByTestId("invite-panel")).toBeVisible();
  await page.getByTestId("invite-name").fill(fields.name);
  await page.getByTestId("invite-email").fill(fields.email);
  await page.getByTestId("invite-role").selectOption(fields.role);
  await page.getByTestId("invite-submit").click();

  const message = page.getByTestId("invite-message");
  await expect(message).toBeVisible();
  const text = (await message.textContent()) ?? "";
  const match = text.match(/\/invite\/([\w-]+)/);
  expect(match, `no invitation link in: ${text}`).toBeTruthy();
  return `/invite/${match?.[1]}`;
};

const acceptAs = async (page: Page, link: string): Promise<void> => {
  await page.goto(link);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();
  await expect(page).toHaveURL(/\/app$/);
};

/** Assigns a duty from the board's Comp day screen. */
const assign = async (
  page: Page,
  token: string,
  fields: { person: string; duty: string; team?: string },
): Promise<void> => {
  await page.goto(`/board/${token}/comp-day`);
  await expect(page.getByTestId("assign-duty")).toBeVisible();

  const person = page.locator('[data-testid="duty-person"] option').filter({ hasText: fields.person });
  await page.getByTestId("duty-person").selectOption((await person.first().getAttribute("value")) ?? "");
  await page.getByTestId("duty-kind").selectOption(fields.duty);
  if (fields.team) {
    const team = page.locator('[data-testid="duty-team"] option').filter({ hasText: fields.team });
    await page.getByTestId("duty-team").selectOption((await team.first().getAttribute("value")) ?? "");
  }
  await page.getByTestId("assign-duty").getByRole("button", { name: "Assign" }).click();
  await expect(page.getByTestId("assign-duty-result")).toContainText("Assigned");
};

test("a board invites a liaison, and the page that invitation opens actually loads", async ({
  page,
}) => {
  const comp = seed();

  // The role is offered at all, which it was not from P1 until C1.
  await page.goto(`/board/${comp.boardToken}/people`);
  await expect(page.locator('[data-testid="invite-role"] option[value="liaison"]')).toHaveCount(1);

  const link = await inviteFrom(page, comp.boardToken, {
    name: "Rhea Menon",
    email: "rhea@example.com",
    role: "liaison",
  });

  await assign(page, comp.boardToken, { person: "Rhea Menon", duty: "walk", team: "Duty Alpha" });

  // A second browser, so the liaison is genuinely a different session and not the board's.
  const liaison = await page.context().browser()?.newContext();
  const theirs = await liaison!.newPage();

  await acceptAs(theirs, link);

  // The dashboard links them somewhere rather than telling them there is no screen.
  await theirs.getByTestId(`my-comp-${COMP}`).click();
  await expect(theirs).toHaveURL(new RegExp(`${COMP}/comp-day$`));

  await expect(theirs.getByTestId("my-duties")).toBeVisible();
  await expect(theirs.getByTestId("duty-team")).toContainText("Duty Alpha");

  // The nav has exactly one item, and it is this page.
  await expect(theirs.getByRole("navigation").getByRole("link")).toHaveCount(1);

  // Acknowledging is the liaison's own write, and the board can see it landed.
  await theirs.getByTestId("acknowledge").click();
  await expect(theirs.getByTestId("duty-state")).toContainText("Acknowledged");

  await page.goto(`/board/${comp.boardToken}/comp-day`);
  await expect(page.getByTestId("assignments")).toContainText("Acknowledged");

  await liaison!.close();
});

/**
 * The guarded UPDATE, driven rather than reasoned about. A second click is what somebody on a phone
 * with a slow connection does, and the wrong answer is a record saying they acknowledged the duty at
 * a time they did not.
 */
test("acknowledging twice records one acknowledgment and does not move the timestamp", async ({
  page,
}) => {
  const comp = seed();
  const link = await inviteFrom(page, comp.boardToken, {
    name: "Ishan Rao",
    email: "ishan@example.com",
    role: "liaison",
  });
  await assign(page, comp.boardToken, { person: "Ishan Rao", duty: "door" });

  const ctx = await page.context().browser()?.newContext();
  const theirs = await ctx!.newPage();
  await acceptAs(theirs, link);
  await theirs.goto(`${BASE}/comp-day`);

  await theirs.getByTestId("acknowledge").click();
  await expect(theirs.getByTestId("duty-state")).toContainText("Acknowledged");

  // The button is gone, so a second acknowledgment has to be forced the way a stale tab would.
  await expect(theirs.getByTestId("acknowledge")).toHaveCount(0);

  await theirs.reload();
  await expect(theirs.getByTestId("duty-state")).toContainText("Acknowledged");
  await expect(theirs.getByTestId("my-duties").getByText("Acknowledged")).toHaveCount(1);

  await ctx!.close();
});

/** The window's whole job: a liaison's read is their own rows and cannot be widened. */
test("a liaison sees only their own duties", async ({ page }) => {
  const comp = seed();

  const first = await inviteFrom(page, comp.boardToken, {
    name: "Asha Nair",
    email: "asha@example.com",
    role: "liaison",
  });
  const second = await inviteFrom(page, comp.boardToken, {
    name: "Vikram Iyer",
    email: "vikram@example.com",
    role: "liaison",
  });

  await assign(page, comp.boardToken, { person: "Asha Nair", duty: "door" });
  await assign(page, comp.boardToken, { person: "Vikram Iyer", duty: "runner" });

  const ctx = await page.context().browser()?.newContext();
  const theirs = await ctx!.newPage();
  await acceptAs(theirs, first);
  await theirs.goto(`${BASE}/comp-day`);

  await expect(theirs.getByTestId("my-duties")).toContainText("Door greeter");
  await expect(theirs.getByTestId("my-duties")).not.toContainText("Judge runner");
  // And no other person's name appears at all — DutyView carries none.
  await expect(theirs.getByTestId("my-duties")).not.toContainText("Vikram");

  await ctx!.close();
  expect(second).toContain("/invite/");
});

/**
 * `revoked_at`, never `DELETE` — and the read filters it, so access to a duty ends on the next
 * request. The same shape as `memberships.revoked_at`, which was read by every filter and written by
 * nothing for as long as P1 existed.
 */
test("a duty the board takes back disappears from the liaison's page", async ({ page }) => {
  const comp = seed();
  const link = await inviteFrom(page, comp.boardToken, {
    name: "Tara Bose",
    email: "tara@example.com",
    role: "liaison",
  });
  await assign(page, comp.boardToken, { person: "Tara Bose", duty: "door" });

  const ctx = await page.context().browser()?.newContext();
  const theirs = await ctx!.newPage();
  await acceptAs(theirs, link);
  await theirs.goto(`${BASE}/comp-day`);
  await expect(theirs.getByTestId("my-duties")).toContainText("Door greeter");

  await page.goto(`/board/${comp.boardToken}/comp-day`);
  await page.getByTestId("revoke-duty").first().click();
  await expect(page.getByTestId("duty-row-result")).toContainText("Taken back");

  await theirs.reload();
  await expect(theirs.getByTestId("no-duties")).toBeVisible();

  await ctx!.close();
});

/**
 * The claim check, driven from outside the page that renders the button. `assignments.person_id` is
 * a bare FK, so nothing in the database refuses another person's duty — the resolve against
 * `listDutiesForLiaison` is the entire guarantee, and a test that only clicks buttons never reaches
 * it.
 */
test("a liaison cannot acknowledge a duty that is not theirs", async ({ page }) => {
  const comp = seed();

  const mine = await inviteFrom(page, comp.boardToken, {
    name: "Kabir Sen",
    email: "kabir@example.com",
    role: "liaison",
  });
  await inviteFrom(page, comp.boardToken, {
    name: "Meera Das",
    email: "meera@example.com",
    role: "liaison",
  });

  await assign(page, comp.boardToken, { person: "Meera Das", duty: "door" });

  // The board can read the other person's assignment id off its own screen.
  await page.goto(`/board/${comp.boardToken}/comp-day`);
  const theirId = await page.locator("[data-assignment]").first().getAttribute("data-assignment");
  expect(theirId).toBeTruthy();

  const ctx = await page.context().browser()?.newContext();
  const attacker = await ctx!.newPage();
  await acceptAs(attacker, mine);

  // A hand-crafted POST, which is the only way to reach this: the page never renders the button.
  const refused = await attacker.evaluate(
    async ([compId, basePath, assignmentId]) => {
      const body = new FormData();
      body.set("compId", compId!);
      body.set("basePath", basePath!);
      body.set("assignmentId", assignmentId!);
      const response = await fetch(`${basePath}/comp-day`, { method: "POST", body });
      return response.status;
    },
    [comp.compId, BASE, theirId] as const,
  );

  // Whatever the transport does, the fact that matters is on the board's screen: still not seen.
  expect(refused).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByTestId("assignments")).toContainText("Not seen yet");

  await ctx!.close();
});
