import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * ADJ·3, the attendee's page — and the second unauthenticated read in the product.
 *
 * The interesting assertions are the negative ones. This is the widest audience anything here has,
 * so a field that should not be on it is least recoverable once it is: the judge whose entire view
 * of the comp is bid codes can read this page like anyone else, and a public name-to-code mapping
 * ends blind judging for that comp (ADR-0008). Team names are already public — the registration
 * form is — so it is the *pairing* that must not exist, and this asserts the codes never render.
 *
 * Scores never render either (PRD B8), and placements come from the frozen snapshot rather than
 * live standings, so the page cannot announce a result before a board has stood behind one.
 */

type SeededComp = {
  compId: string;
  boardToken: string;
  judges: { name: string; token: string }[];
};

const ORG = "public-e2e-org";
const COMP = "public-e2e-comp";
const DRAFT = "public-e2e-draft";

const BID_CODES = ["A-1", "A-2", "A-3", "W-1", "D-1"];

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const config = (slug: string, status: string) => ({
  org: { name: "Public E2E Org", slug: ORG },
  comp: {
    name: status === "draft" ? "Unannounced Comp" : "Public E2E 2027",
    slug,
    compDate: "2027-02-20",
    venue: "Test Auditorium",
    status,
  },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    tiebreakers: [{ kind: "head_to_head" }],
    criteria: [
      { label: "Choreography", maxPoints: 30 },
      { label: "Execution", maxPoints: 30 },
    ],
  },
  // One of each status that matters: three in the comp, one still waiting, one turned away. The
  // last two are the ones the page must not mention.
  teams: [
    { name: "Kinetic Collective", school: "State University", bidCode: "A-1", status: "accepted" },
    { name: "Nritya Ensemble", school: "City College", bidCode: "A-2", status: "accepted" },
    { name: "Taal Company", bidCode: "A-3", status: "accepted" },
    { name: "Still Waiting Crew", bidCode: "W-1", status: "waitlisted", waitlistRank: 1 },
    { name: "Turned Away Crew", bidCode: "D-1", status: "dropped" },
  ],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Board Chair" }],
  registration: {
    waiverText: "Teams compete at their own risk.",
    requireAuditionUrl: true,
    maxRosterSize: 30,
  },
});

/**
 * A bid code is checked against the markup as well as the text: it must not be a data attribute or
 * a sort key either, and the codes are distinctive enough that a hash cannot produce one by
 * accident (they carry a hyphen and a capital letter; Next's hashes are lowercase hex).
 */
const expectNoBidCodes = async (page: Page): Promise<void> => {
  const markup = (await page.locator("body").innerText()) + (await page.content());
  for (const code of BID_CODES) expect(markup).not.toContain(code);
};

const seed = (slug: string, status: string): SeededComp => {
  const file = tmp(`${slug}.json`);
  writeFileSync(file, JSON.stringify(config(slug, status)));

  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", file, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

test("an attendee sees the comp, the lineup, and no way to un-blind a judge", async ({
  browser,
}) => {
  seed(COMP, "open");

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/c/${ORG}/${COMP}`);

  await expect(page.getByRole("heading", { name: "Public E2E 2027" })).toBeVisible();
  await expect(page.getByText("Test Auditorium")).toBeVisible();
  await expect(page.getByText("Public E2E Org")).toBeVisible();

  // Registration is open, so the page is the front door to the form.
  await expect(page.getByTestId("public-register")).toBeVisible();
  await page.getByRole("link", { name: /Apply to compete/ }).click();
  await expect(page.getByTestId("registration-form")).toBeVisible();
  await page.goBack();

  // The lineup is the teams actually in the comp. A team still on the waitlist, and one the board
  // turned away, are the board's business — publishing either is a different product.
  const teams = page.getByTestId("public-teams");
  await expect(teams).toContainText("Kinetic Collective");
  await expect(teams).toContainText("Nritya Ensemble");
  await expect(teams).toContainText("Taal Company");
  await expect(page.getByText("Still Waiting Crew")).toHaveCount(0);
  await expect(page.getByText("Turned Away Crew")).toHaveCount(0);

  // Nothing has been locked, so there is no result to announce.
  await expect(page.getByTestId("public-placements")).toHaveCount(0);

  // The assertion this page exists to keep: a judge reading it learns no team's bid code.
  await expectNoBidCodes(page);

  await context.close();
});

test("a comp its board has not announced is not there at all", async ({ browser }) => {
  seed(DRAFT, "draft");

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Not "this comp is not public yet" — that sentence confirms it exists, which is the fact the
  // board has not published. The same 404 a comp that was never created would serve.
  const draft = await page.goto(`/c/${ORG}/${DRAFT}`);
  expect(draft?.status()).toBe(404);

  const absent = await page.goto(`/c/${ORG}/no-such-comp`);
  expect(absent?.status()).toBe(404);

  await context.close();
});

test("placements appear only once they are locked, and carry no scores", async ({ browser }) => {
  const comp = seed(COMP, "open");

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  const judge = await context.newPage();
  await judge.goto(`/judge/${comp.judges[0]!.token}`);

  // Score every team, so the locked run places all three rather than leaving two unscored. The
  // pairs total 55 / 51 / 47, which is both a real ordering and three numbers that appear nowhere
  // else on the public page — so asserting their absence below means something.
  const cards = judge.locator('form[data-testid^="team-card-"]');
  await expect(cards.first()).toBeVisible();

  const scores = [
    [28, 27],
    [26, 25],
    [24, 23],
  ];
  for (const [index, [choreography, execution]] of scores.entries()) {
    const card = cards.nth(index);
    await card.getByLabel("Choreography", { exact: true }).fill(String(choreography));
    await card.getByLabel("Execution", { exact: true }).fill(String(execution));
    await card.getByRole("button", { name: /Submit|Update/ }).click();
    await expect(card.getByText("Scored")).toBeVisible({ timeout: 30_000 });
  }
  await judge.close();

  const page = await context.newPage();
  await page.goto(`/c/${ORG}/${COMP}`);
  await expect(page.getByTestId("public-placements")).toHaveCount(0);

  const board = await context.newPage();
  await board.goto(`/board/${comp.boardToken}`);
  await board.getByTestId("lock-button").click();
  await expect(board.getByRole("heading", { name: "Final placements" })).toBeVisible();

  await page.reload();
  const placements = page.getByTestId("public-placements");
  await expect(placements).toBeVisible();
  await expect(placements).toContainText("Kinetic Collective");

  // A real ordering, not whatever order the roster happened to come back in.
  await expect(placements.locator("li").first()).toContainText("Kinetic Collective");
  await expect(placements.locator("li").last()).toContainText("Taal Company");

  // A team learns its placement, never the numbers behind it. Publishing those invites an argument
  // over a 27-vs-28 that no board can win, so no aggregate reaches the page — the type is what
  // enforces that, and this is what would catch it being widened.
  //
  // Read against the visible text, not the markup: a two-digit number matches inside Next's own
  // asset hashes, so asserting it against `content()` would fail on a page that is perfectly fine.
  await expectNoBidCodes(page);
  const visible = await page.locator("body").innerText();
  for (const aggregate of ["55", "51", "47"]) expect(visible).not.toContain(aggregate);

  await context.close();
});
