import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * A `teamId` on a form is a claim, not a fact.
 *
 * `scores.team_id`, `judge_notes.team_id` and `deductions.team_id` are bare FKs to `teams.id`, so
 * the database will accept a row naming a team from *another comp* — it is a real team, and the
 * constraint is satisfied. Nothing downstream catches it either: `tabulate()` filters rows that
 * name a team off the roster straight back out of the arithmetic, which means the write succeeds,
 * the actor is told it worked, and it counts for nothing. A deduction that silently does not apply
 * is worse than one that fails.
 *
 * So the check has to happen in the write path, against the same scoped read that produced the
 * form. This drives the four write paths that take a `teamId` and proves each refuses — and, more
 * importantly, that no row is left behind. The forged value is a real team id belonging to a real
 * second comp, seeded here for the purpose, because a random uuid would be refused by the foreign
 * key and would prove nothing about the check.
 */

type SeededComp = {
  compId: string;
  compName: string;
  boardName: string;
  boardToken: string;
  judges: { name: string; token: string }[];
};

type Team = { id: string; name: string; bidCode: string };

const CRITERIA = [
  { label: "Choreography", maxPoints: 30 },
  { label: "Execution", maxPoints: 30 },
  { label: "Musicality", maxPoints: 20 },
  { label: "Stage Presence", maxPoints: 20 },
];

const TEAM_COUNT = 8;
const NOT_COMPETING = "That team is not competing in this comp.";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const seedDemo = (): SeededComp => {
  const file = tmp("demo.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--json", file], { stdio: "pipe" });
  return JSON.parse(readFileSync(file, "utf8")) as SeededComp;
};

/**
 * A second, entirely unrelated comp, under its own org slug so seeding it cannot disturb the demo
 * (the seeder deletes by org slug). Its teams are the ones the forged forms will name.
 */
const seedOtherComp = (): SeededComp => {
  const example = JSON.parse(readFileSync("comp-config.example.json", "utf8")) as Record<
    string,
    unknown
  >;
  const config = tmp("other.json");
  writeFileSync(config, JSON.stringify(example));

  const out = tmp("other-seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const probe = <T>(command: string, id: string): T =>
  JSON.parse(
    execFileSync("bunx", ["tsx", "e2e/support/probe.ts", command, id], { encoding: "utf8" }),
  ) as T;

const rowsFor = (teamId: string): { scores: number; notes: number; deductions: number } =>
  probe("rows", teamId);

/**
 * Overwrite a form's `teamId` in the DOM — the claim a hostile or stale client can make.
 *
 * Must be the last thing done before submitting: filling any other field re-renders the form and
 * React restores the hidden input to the value it rendered.
 */
const forgeTeamId = async (field: import("@playwright/test").Locator, teamId: string) => {
  await field.evaluate((element, value) => {
    const input = element as HTMLInputElement | HTMLSelectElement;
    if (input instanceof HTMLSelectElement) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = "forged";
      input.append(option);
    }
    input.value = value;
  }, teamId);
};

const scoreEveryTeam = async (page: import("@playwright/test").Page) => {
  const cards = page.locator('form[data-testid^="team-card-"]');
  await expect(cards).toHaveCount(TEAM_COUNT);

  for (let teamIndex = 0; teamIndex < TEAM_COUNT; teamIndex++) {
    const card = cards.nth(teamIndex);
    for (const criterion of CRITERIA) {
      await card
        .getByLabel(criterion.label, { exact: true })
        .fill(String(Math.max(0, criterion.maxPoints - teamIndex * 2)));
    }
    await card.getByRole("button", { name: /Submit|Update/ }).click();
    await expect(card.getByText("Scored")).toBeVisible();
  }
};

test("a teamId from another comp is refused by every write path, and leaves no row", async ({
  browser,
}) => {
  const demo = seedDemo();
  const other = seedOtherComp();

  const otherTeams = probe<Team[]>("teams", other.compId);
  const foreign = otherTeams[0]!;
  expect(otherTeams.length).toBeGreaterThan(0);

  // Nothing has ever been written against this team. Every assertion below is against this baseline.
  expect(rowsFor(foreign.id)).toEqual({ scores: 0, notes: 0, deductions: 0 });

  const judge = demo.judges[0]!;
  const judgeContext = await browser.newContext();
  const judgePage = await judgeContext.newPage();
  await judgePage.goto(`/judge/${judge.token}`);

  const cards = judgePage.locator('form[data-testid^="team-card-"]');
  await expect(cards).toHaveCount(TEAM_COUNT);

  // 1. The judge's score path. Fill first, forge last: any other fill re-renders the form.
  const card = cards.first();
  for (const criterion of CRITERIA) {
    await card.getByLabel(criterion.label, { exact: true }).fill(String(criterion.maxPoints));
  }
  await forgeTeamId(card.locator('input[name="teamId"]'), foreign.id);
  await card.getByRole("button", { name: /Submit|Update/ }).click();
  await expect(judgePage.getByText(NOT_COMPETING).first()).toBeVisible();

  // 2. The judge's note path. Same forgery, different table.
  const noteForm = judgePage.locator('form:has(textarea[name="note"])').first();
  await noteForm.locator('textarea[name="note"]').fill("Lovely formations.");
  await forgeTeamId(noteForm.locator('input[name="teamId"]'), foreign.id);
  await noteForm.getByRole("button", { name: "Save note" }).click();
  await expect(judgePage.getByText(NOT_COMPETING).first()).toBeVisible();

  await judgeContext.close();

  // 3. The board's pre-lock deduction path -- the one that had no check at all. The dropdown is
  // built from the standings, so a team has to have been scored before it can be deducted from.
  const board = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const boardPage = await board.newPage();
  await boardPage.goto(`/board/${demo.boardToken}`);

  const deductionForm = boardPage.locator('form:has(button:has-text("Apply deduction"))');
  await deductionForm.getByLabel("Points").fill("10");
  await deductionForm.getByLabel("Reason").fill("forged");
  await forgeTeamId(deductionForm.locator('select[name="teamId"]'), foreign.id);
  await deductionForm.getByRole("button", { name: "Apply deduction" }).click();
  await expect(boardPage.getByText(NOT_COMPETING)).toBeVisible();

  // The refusals are only worth anything if the tables agree with them.
  expect(rowsFor(foreign.id)).toEqual({ scores: 0, notes: 0, deductions: 0 });

  await board.close();
});

test("a deduction against a team dropped after the page rendered is refused, not silently voided", async ({
  browser,
}) => {
  const demo = seedDemo();

  // A team only reaches the deduction dropdown once it has been placed, so a judge scores first.
  const judgeContext = await browser.newContext();
  const judgePage = await judgeContext.newPage();
  await judgePage.goto(`/judge/${demo.judges[0]!.token}`);
  await scoreEveryTeam(judgePage);
  await judgeContext.close();

  const board = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const boardPage = await board.newPage();
  await boardPage.goto(`/board/${demo.boardToken}`);

  // The board's open tab lists the placed roster in the deduction dropdown.
  const deductionForm = boardPage.locator('form:has(button:has-text("Apply deduction"))');
  const select = deductionForm.locator('select[name="teamId"]');
  const teamId = await select.locator("option").nth(1).getAttribute("value");
  expect(teamId).toBeTruthy();

  // The team withdraws. No malice, no forged request -- just a stale form, which is the ordinary
  // comp-day accident. Before the check existed, the deduction row was written, the board was told
  // "Applied -10", and `tabulate()` then dropped it for naming a team off the roster.
  execFileSync("bunx", ["tsx", "e2e/support/probe.ts", "drop", teamId!], { stdio: "pipe" });

  await select.selectOption(teamId!);
  await deductionForm.getByLabel("Points").fill("10");
  await deductionForm.getByLabel("Reason").fill("exceeded time limit");
  await deductionForm.getByRole("button", { name: "Apply deduction" }).click();

  await expect(boardPage.getByText(NOT_COMPETING)).toBeVisible();
  expect(rowsFor(teamId!).deductions).toBe(0);

  await board.close();
});

/**
 * ADR-0022's one security-critical line, driven end to end.
 *
 * `resolveBoardAccess` accepts a board actor from two places, and only one of them is scoped by
 * construction. `membershipFor` is asked about a specific `(person, comp, role)` and cannot answer
 * about another comp; a **token** is not — `resolveBoardActor` resolves whatever assignment the
 * token names, at whatever comp it belongs to. So the link path has to prove the comp matches, and
 * without that check a board member at one comp could hold their own entirely valid cookie and read
 * another org's roster by editing the URL.
 *
 * That is a worse failure than the forged `teamId` above: it is a whole comp rather than one row,
 * and it needs no forgery at all — just a legitimate credential and a guess at a slug.
 */
test("a board link for one comp opens nothing at another", async ({ browser }) => {
  const demo = seedDemo();
  seedOtherComp();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Through the door, so the cookie is set exactly as a real board member's would be.
  await page.goto(`/board/${demo.boardToken}`);
  await expect(page).toHaveURL(/\/app\/maryland-mayuri\/mayuri-2027$/);
  await expect(page.getByTestId("comp-name")).toBeVisible();

  // The same browser, the same valid cookie, a different comp. Every screen refuses.
  for (const path of ["", "/roster", "/money", "/results", "/people"]) {
    const response = await page.goto(`/app/example-dance-org/example-comp-2027${path}`);
    expect(response?.status(), `expected 404 at ${path || "/"}`).toBe(404);
  }

  // And the polling endpoint, which is the one that does not look like a page.
  const probeResponse = await page.request.get("/api/board/not-this-comp");
  expect(probeResponse.status()).toBe(404);

  await context.close();
});
