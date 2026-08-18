import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

/**
 * G4 — each person's own re-timed timeline, replacing the ~30-column hand-compiled SATURDAY sheet.
 *
 * The guarantee is the same one the fifth window carries and it is worth stating as a *negative*: a
 * liaison sees the teams they are walking and the fixtures everybody shares, and **no other team's
 * row at all** — even though the derivation had to read the whole draw to compute their times, since
 * position 6 depends on positions 1 through 5. The filtering is in the query, not the markup.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "timeline-e2e-org";
const COMP = "timeline-e2e-comp";
const PASSWORD = "a passphrase long enough to pass";
const BASE = `/app/${ORG}/${COMP}`;

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Timeline E2E Org", slug: ORG },
  comp: { name: "Timeline E2E 2027", slug: COMP, compDate: "2027-03-06", status: "live" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [
    { name: "Walked Team", bidCode: "W-1", status: "accepted", rosterSize: 18 },
    { name: "Other Team", bidCode: "W-2", status: "accepted", rosterSize: 18 },
  ],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Timeline Chair" }],
  duties: [{ id: "walk", label: "Team liaison", category: "team", swaRequired: false }],
  schedule: {
    anchor: "2027-03-06T12:00",
    timezone: "America/New_York",
    firstSlotAtMinute: 120,
    slotMinutes: 8,
    changeoverMinutes: 4,
    rooms: [{ id: "stage", label: "Main stage" }],
    teamBuffers: [{ kind: "walk", durationMinutes: 6, endsBeforePerformance: 0, room: "stage" }],
    compSegments: [
      {
        kind: "food",
        id: "dinner",
        label: "Dinner",
        startsAtMinute: 300,
        durationMinutes: 60,
        movesWithShow: false,
      },
    ],
    slack: [],
  },
};

const seed = (): SeededComp => {
  const config = tmp("timeline.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

/**
 * Invites somebody, **from a board context of its own**, and returns the acceptance link.
 *
 * The separation is not tidiness. `/board/<token>/…` leaves an `HttpOnly` board-link cookie on the
 * context, and `resolveBoardAccess` tries a session *then* that cookie (ADR-0022) — so a browser that
 * has ever opened a board link and then signed in as a liaison still resolves as **board**, and gets
 * the board's half of comp day. A first draft of this file invited and accepted on one page and
 * spent three runs asserting against a screen that belonged to somebody else.
 */
const invite = async (
  browser: Browser,
  token: string,
  who: { name: string; email: string; role: string; team?: string },
): Promise<string> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/board/${token}/people`);
  await expect(page.getByTestId("invite-panel")).toBeVisible();
  await page.getByTestId("invite-name").fill(who.name);
  await page.getByTestId("invite-email").fill(who.email);
  await page.getByTestId("invite-role").selectOption(who.role);
  if (who.team) {
    const option = page.locator('[data-testid="invite-team"] option').filter({ hasText: who.team });
    await page
      .getByTestId("invite-team")
      .selectOption((await option.first().getAttribute("value")) ?? "");
  }
  await page.getByTestId("invite-submit").click();

  // The link is printed in the success message rather than in its own element, because sending is
  // opt-in and a board on an unconfigured host still has to be able to hand it over by copying it.
  const message = page.getByTestId("invite-message");
  await expect(message).toBeVisible();
  const text = (await message.textContent()) ?? "";
  const match = text.match(/\/invite\/([\w-]+)/);
  expect(match, `no invitation link in: ${text}`).toBeTruthy();
  await context.close();
  return `/invite/${match?.[1]}`;
};

/** Accepts on a context that has never seen a board link, so the session is the only credential. */
const accept = async (page: Page, link: string): Promise<void> => {
  await page.goto(link);
  await page.getByTestId("credential-password").fill(PASSWORD);
  await page.getByTestId("credential-confirm").fill(PASSWORD);
  await page.getByTestId("credential-submit").click();
  await expect(page).toHaveURL(/\/app$/);
};

/** Assigns a team duty from the board's Comp day screen. */
const assign = async (
  browser: Browser,
  token: string,
  fields: { person: string; team: string },
): Promise<{ close: () => Promise<void>; page: Page }> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/board/${token}/comp-day`);
  await expect(page.getByTestId("assign-duty")).toBeVisible();
  const person = page
    .locator('[data-testid="duty-person"] option')
    .filter({ hasText: fields.person });
  await page
    .getByTestId("duty-person")
    .selectOption((await person.first().getAttribute("value")) ?? "");
  await page.getByTestId("duty-kind").selectOption("walk");
  const team = page.locator('[data-testid="duty-team"] option').filter({ hasText: fields.team });
  await page
    .getByTestId("duty-team")
    .selectOption((await team.first().getAttribute("value")) ?? "");
  await page.getByTestId("assign-duty").getByRole("button", { name: "Assign" }).click();
  await expect(page.getByTestId("assign-duty-result")).toContainText("Assigned");
  return { page, close: () => context.close() };
};

test("a liaison sees the team they walk and the fixtures everybody shares, and no other team", async ({
  page,
  browser,
}) => {
  const { boardToken } = seed();

  await accept(
    page,
    await invite(browser, boardToken, {
      name: "Liaison One",
      email: "liaison-timeline@example.com",
      role: "liaison",
    }),
  );

  // The board gives them one team duty, from a context of its own.
  const board = await assign(browser, boardToken, {
    person: "Liaison One",
    team: "Walked Team",
  });

  await page.goto(`${BASE}/comp-day`);
  await expect(page.getByTestId("my-timeline")).toBeVisible();

  const mine = (await page.getByTestId("my-timeline-entry").allInnerTexts()).join(" | ");
  expect(mine).toContain("Walked Team");
  // The derivation read the whole draw to compute these times. It returns none of it.
  expect(mine).not.toContain("Other Team");
  // A comp-wide fixture belongs to nobody, so everybody gets it.
  expect(mine).toContain("Food");

  await board.close();
});

test("a delay reaches the liaison's own page, which is the copy that used to go stale", async ({
  page,
  browser,
}) => {
  const { boardToken } = seed();

  await accept(
    page,
    await invite(browser, boardToken, {
      name: "Liaison Two",
      email: "liaison-timeline2@example.com",
      role: "liaison",
    }),
  );

  const board = await assign(browser, boardToken, {
    person: "Liaison Two",
    team: "Walked Team",
  });

  await page.goto(`${BASE}/comp-day`);
  const before = (await page.getByTestId("my-timeline-entry").allInnerTexts()).join(" | ");
  await expect(page.getByTestId("my-timeline-delay")).toHaveCount(0);

  await board.page.getByTestId("delay-minutes").fill("25");
  await board.page.getByTestId("delay-from").fill("1");
  await board.page.getByTestId("delay-reason").fill("stage tech overran");
  await board.page.getByTestId("delay-submit").click();
  await expect(board.page.getByTestId("schedule-message")).toContainText("re-timed");

  // PRD §9's actual complaint: "every printed and open copy goes silently stale." This is the copy.
  await page.reload();
  await expect(page.getByTestId("my-timeline-delay")).toContainText("25 minutes behind");
  const after = (await page.getByTestId("my-timeline-entry").allInnerTexts()).join(" | ");
  expect(after).not.toBe(before);

  await board.close();
});

test("a captain sees their own team's timings and nobody else's", async ({ page, browser }) => {
  const { boardToken } = seed();

  await accept(
    page,
    await invite(browser, boardToken, {
      name: "Captain One",
      email: "captain-timeline@example.com",
      role: "captain",
      team: "Walked Team",
    }),
  );

  await page.goto(`${BASE}/team`);
  await expect(page.getByTestId("my-timeline")).toBeVisible();

  const mine = (await page.getByTestId("my-timeline-entry").allInnerTexts()).join(" | ");
  expect(mine).toContain("Walked Team");
  expect(mine).not.toContain("Other Team");
});

test("a liaison with no team duty is told so rather than shown an empty box", async ({
  page,
  browser,
}) => {
  const { boardToken } = seed();

  await accept(
    page,
    await invite(browser, boardToken, {
      name: "Liaison Three",
      email: "liaison-timeline3@example.com",
      role: "liaison",
    }),
  );

  await page.goto(`${BASE}/comp-day`);
  // No duty at all, so no team's segments -- but the comp-wide fixtures are still theirs.
  const mine = (await page.getByTestId("my-timeline-entry").allInnerTexts()).join(" | ");
  expect(mine).toContain("Food");
  expect(mine).not.toContain("Walked Team");
});
