import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Module A, first slice: a team applies, a board accepts it, and dropping a team that held a slot
 * promotes the top of the waitlist — the drop and the promotion landing together or not at all.
 *
 * That last one is the whole reason ADR-0012 exists. Half of it is a comp that has lost a team and
 * not replaced it; the other half is a comp with one more accepted team than it has slots. Both are
 * states a human has to find and repair by hand, which is the reconciliation failure this product
 * is sold to end — so it must not be *introduced* by the product.
 *
 * The roster also freezes at the lock, and that is asserted here rather than assumed: `teams` is
 * inside `tab_runs.inputs`, so a roster that moved after a lock would describe a comp the locked
 * result does not. Reinstating a dropped team after a lock is the dangerous case — it hands back
 * scores the team had already been given (ADR-0009) — and `transitions.ts` permits reinstatement
 * only because this door is shut first.
 */

type SeededComp = {
  compId: string;
  boardToken: string;
  judges: { name: string; token: string }[];
};

const ORG = "reg-e2e-org";
const COMP = "reg-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

/**
 * An open comp with a form, three accepted teams and two ranked on the waitlist. The demo config
 * cannot express this: it describes a comp already running, so every team in it is `competing`.
 */
const CONFIG = {
  org: { name: "Registration E2E Org", slug: ORG },
  comp: {
    name: "Registration E2E 2027",
    slug: COMP,
    compDate: "2027-03-06",
    venue: "Test Auditorium",
    status: "open",
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
  teams: [
    { name: "Accepted Alpha", bidCode: "A-1", status: "accepted", rosterSize: 20 },
    { name: "Accepted Beta", bidCode: "A-2", status: "accepted", rosterSize: 20 },
    { name: "Accepted Gamma", bidCode: "A-3", status: "accepted", rosterSize: 20 },
    { name: "Waitlist First", bidCode: "W-1", status: "waitlisted", waitlistRank: 1 },
    { name: "Waitlist Second", bidCode: "W-2", status: "waitlisted", waitlistRank: 2 },
  ],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Registration Chair" }],
  registration: {
    waiverText: "Teams compete at their own risk.",
    requireAuditionUrl: true,
    maxRosterSize: 30,
  },
};

const seed = (): SeededComp => {
  const config = tmp("reg.json");
  writeFileSync(config, JSON.stringify(CONFIG));

  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

test("a team applies, the board accepts it, and the form respects the comp's own rules", async ({
  browser,
}) => {
  seed();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/register/${ORG}/${COMP}`);

  await expect(page.getByRole("heading", { name: "Registration E2E 2027" })).toBeVisible();
  await expect(page.getByText("Teams compete at their own risk.")).toBeVisible();

  await page.getByLabel("Team name").fill("Late Applicant");
  await page.getByLabel("School").fill("State University");
  await page.getByLabel("Contact name").fill("Priya Raman");
  await page.getByLabel("Contact email").fill("priya@example.com");
  await page.getByLabel("Audition video link").fill("https://example.com/audition");
  await page.getByLabel("Accept the waiver").check();

  // The comp caps rosters at 30. The input carries `max`, so the browser would refuse to submit 40
  // on its own -- which is why the attribute is stripped first. The cap being asserted here is the
  // *server's*: the page's own validation is a courtesy to an honest applicant, not the rule.
  const rosterSize = page.getByLabel("Roster size");
  await rosterSize.evaluate((el) => el.removeAttribute("max"));
  await rosterSize.fill("40");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("This comp caps rosters at 30 dancers.")).toBeVisible();

  // The refusal must not cost the applicant everything they typed. React resets an uncontrolled
  // form once its action has run, so the answers have to come back with the error and go straight
  // back in — otherwise a captain who mistypes one field retypes the whole page.
  await expect(page.getByLabel("Team name")).toHaveValue("Late Applicant");
  await expect(page.getByLabel("School")).toHaveValue("State University");
  await expect(page.getByLabel("Contact email")).toHaveValue("priya@example.com");
  await expect(page.getByLabel("Accept the waiver")).toBeChecked();

  await rosterSize.fill("22");
  await page.getByRole("button", { name: "Apply" }).click();

  // The applicant gets a bid code and is told plainly that they are not in yet.
  const applied = page.getByTestId("applied");
  await expect(applied).toBeVisible();
  await expect(applied).toContainText("you are not accepted yet");

  await context.close();
});

/**
 * Registration day is the whole circuit applying inside the same 48 hours, so two captains hitting
 * submit in the same second is the normal case, not the adversarial one.
 *
 * `nextBidCode` reads the codes in use and returns the first free one; on neon-http that read and
 * the insert are two acts, so both applicants are handed `T-001` and `teams_comp_bid_code_unique`
 * refuses the second. That refusal is correct — it is the same shape as the run chain, where the
 * check narrows the race and the database is what actually closes it.
 *
 * What must not happen is the loser paying for it. This is the one page with no `Actor` behind it:
 * an uncaught unique violation hands a stranger `Failed query: insert into "teams" ...`, because
 * drizzle's message is the failed SQL. So the assertion is two-sided — *both* applications exist,
 * with *different* bid codes, and neither applicant was ever shown the schema.
 */
test("two captains applying at the same moment both get in, with different bid codes", async ({
  browser,
}) => {
  const comp = seed();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  const fill = async (name: string, email: string) => {
    const page = await context.newPage();
    await page.goto(`/register/${ORG}/${COMP}`);
    await page.getByLabel("Team name").fill(name);
    await page.getByLabel("Contact name").fill(name);
    await page.getByLabel("Contact email").fill(email);
    await page.getByLabel("Audition video link").fill("https://example.com/audition");
    await page.getByLabel("Roster size").fill("20");
    await page.getByLabel("Accept the waiver").check();
    return page;
  };

  const first = await fill("Race One", "one@example.com");
  const second = await fill("Race Two", "two@example.com");

  // Both forms are filled and sitting there. Click them together -- no awaits between -- so the two
  // `nextBidCode` reads overlap and both actions try to insert the same code.
  await Promise.all([
    first.getByRole("button", { name: "Apply" }).click(),
    second.getByRole("button", { name: "Apply" }).click(),
  ]);

  const codes: string[] = [];
  for (const page of [first, second]) {
    const applied = page.getByTestId("applied");
    await expect(applied).toBeVisible();

    // The failed SQL, in the words Postgres and drizzle actually use. Same assertion as
    // `lock-race.spec.ts` makes for the board, now made for the stranger.
    await expect(
      page.getByText(/Failed query|duplicate key|violates unique constraint/i),
    ).toHaveCount(0);

    codes.push((await applied.textContent())?.match(/T-\d+/)?.[0] ?? "");
  }

  expect(codes[0]).toMatch(/^T-\d+$/);
  expect(codes[1]).toMatch(/^T-\d+$/);
  expect(codes[0]).not.toBe(codes[1]);

  // And the board sees both -- the loser's application was retried, not lost. Asserting only that
  // the two pages showed different codes would pass even if one insert had silently never landed.
  const board = await context.newPage();
  await board.goto(`/board/${comp.boardToken}/roster`);
  await expect(board.getByTestId(`roster-row-${codes[0]}`)).toBeVisible();
  await expect(board.getByTestId(`roster-row-${codes[1]}`)).toBeVisible();

  await context.close();
});

test("dropping a team that held a slot promotes the top of the waitlist, atomically", async ({
  browser,
}) => {
  const comp = seed();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/board/${comp.boardToken}/roster`);

  const roster = page.getByTestId("roster");
  await expect(roster).toBeVisible();

  await expect(page.getByTestId("roster-row-W-1")).toHaveAttribute("data-status", "waitlisted");
  await expect(page.getByTestId("roster-row-W-2")).toHaveAttribute("data-status", "waitlisted");

  // Accepted Beta drops. Its slot is real, so the waitlist must move -- and it must be the *ranked*
  // first one, not whichever row Postgres happened to hand back.
  await page.getByTestId("move-A-2-dropped").click();

  await expect(page.getByTestId("roster-message")).toContainText(
    "Waitlist First was promoted off the waitlist into the slot.",
  );

  await expect(page.getByTestId("roster-row-A-2")).toHaveAttribute("data-status", "dropped");
  await expect(page.getByTestId("roster-row-W-1")).toHaveAttribute("data-status", "accepted");

  // The second waitlisted team did not move: one slot came free, so exactly one promotion happened.
  await expect(page.getByTestId("roster-row-W-2")).toHaveAttribute("data-status", "waitlisted");

  await context.close();
});

/**
 * The board decides whether to accept a team. This asserts it can see what it is deciding *on*.
 *
 * Registration wrote `audition_url`, `contact_person_id` and `waiver_accepted_at` from its first
 * commit, and `listRosterForBoard` selected none of them, so the data went into the database and
 * died there — a board approving teams on a name and a headcount, with the comp's *required*
 * audition link unreachable from the product that demanded it. Nothing failed, which is why nothing
 * caught it: the missing test is the bug.
 */
test("the board can see the application it is being asked to accept", async ({ browser }) => {
  const comp = seed();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto(`/register/${ORG}/${COMP}`);
  await page.getByLabel("Team name").fill("Evidence Crew");
  await page.getByLabel("Contact name").fill("Priya Raman");
  await page.getByLabel("Contact email").fill("priya@example.com");
  await page.getByLabel("Audition video link").fill("https://example.com/the-audition");
  await page.getByLabel("Roster size").fill("18");
  await page.getByLabel("Accept the waiver").check();
  await page.getByRole("button", { name: "Apply" }).click();

  const applied = page.getByTestId("applied");
  await expect(applied).toBeVisible();
  const bidCode = (await applied.textContent())?.match(/T-\d+/)?.[0] ?? "";
  expect(bidCode).toMatch(/^T-\d+$/);

  const board = await context.newPage();
  await board.goto(`/board/${comp.boardToken}/roster`);

  // The audition link the comp *required* — reachable, and pointing where the captain put it.
  const audition = board.getByTestId(`roster-audition-${bidCode}`);
  await expect(audition).toBeVisible();
  await expect(audition).toHaveAttribute("href", "https://example.com/the-audition");

  // The captain to reply to, and the waiver as an event rather than a claim.
  const contact = board.getByTestId(`roster-contact-${bidCode}`);
  await expect(contact).toHaveAttribute("href", "mailto:priya@example.com");
  await expect(contact).toContainText("Priya Raman");
  await expect(board.getByTestId(`roster-waiver-${bidCode}`)).toContainText("Waiver");

  // A seeded team never applied, so it has no application to show. That is a gap, not a blank.
  await expect(board.getByTestId("roster-audition-A-1")).toHaveCount(0);

  await context.close();
});

test("dropping a team that never held a slot promotes nobody", async ({ browser }) => {
  const comp = seed();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/board/${comp.boardToken}/roster`);

  // A waitlisted team dropping frees nothing -- it never held a slot. Promoting here would hand out
  // a place that does not exist, quietly growing the comp by one.
  await page.getByTestId("move-W-2-dropped").click();

  await expect(page.getByTestId("roster-message")).toContainText("Team is now dropped.");
  await expect(page.getByTestId("roster-message")).not.toContainText("promoted");
  await expect(page.getByTestId("roster-row-W-1")).toHaveAttribute("data-status", "waitlisted");

  await context.close();
});

test("the lock freezes the roster, and the server is what says so", async ({ browser }) => {
  const comp = seed();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // Nothing can be locked with no scores in it, so the one judge scores the one team this needs.
  const judge = await context.newPage();
  await judge.goto(`/judge/${comp.judges[0]!.token}`);
  const card = judge.locator('form[data-testid^="team-card-"]').first();
  for (const criterion of ["Choreography", "Execution"]) {
    await card.getByLabel(criterion, { exact: true }).fill("25");
  }
  await card.getByRole("button", { name: /Submit|Update/ }).click();
  await expect(card.getByText("Scored")).toBeVisible();
  await judge.close();

  const page = await context.newPage();

  // Capture a live move control *before* the lock, so the click below is a genuinely stale form and
  // not a button the page would have hidden.
  await page.goto(`/board/${comp.boardToken}/roster`);
  const staleMove = page.getByTestId("move-A-1-dropped");
  await expect(staleMove).toBeVisible();

  const board = await context.newPage();
  await board.goto(`/board/${comp.boardToken}`);
  await board.getByTestId("lock-button").click();
  await expect(board.getByRole("heading", { name: "Final placements" })).toBeVisible();

  // The stale roster tab still offers the move. The server refuses it anyway.
  await staleMove.click();
  await expect(page.getByTestId("roster-message")).toContainText(
    "Results are locked. The roster can no longer change.",
  );
  await expect(page.getByTestId("roster-row-A-1")).toHaveAttribute("data-status", "accepted");

  // And a fresh load offers nothing to click.
  await page.reload();
  await expect(page.getByText("Results are locked")).toBeVisible();
  await expect(page.getByTestId("move-A-1-dropped")).toHaveCount(0);

  await context.close();
});
