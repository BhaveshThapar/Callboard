import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * A1's last gap: the form was fixed, so a board wanting to ask one more question had to run a
 * second Google Form — and the answers then lived somewhere the roster screen could not reach,
 * which is the acceptance-doc-vs-Venmo split reproduced in a smaller way.
 *
 * The two halves that matter are both asserted here. The **server** is what validates, not the
 * markup: the `required` attributes are stripped before submitting, exactly as the roster-cap test
 * does, because a form a stranger can edit is not the thing that should decide what gets written.
 * And what a comp collects, its board can **see** — an answer nobody reads is the mistake ADR-0010
 * removed a column to fix.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "fields-e2e-org";
const COMP = "fields-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Fields E2E Org", slug: ORG },
  comp: {
    name: "Fields E2E 2027",
    slug: COMP,
    compDate: "2027-03-06",
    venue: "Test Auditorium",
    status: "open",
  },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    tiebreakers: [{ kind: "head_to_head" }],
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [{ name: "Seeded Crew", bidCode: "A-1", status: "accepted", rosterSize: 20 }],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Registration Chair" }],
  registration: {
    waiverText: "Teams compete at their own risk.",
    requireAuditionUrl: false,
    maxRosterSize: 30,
    // One of every type, so the renderer and the validator are both exercised end to end.
    fields: [
      {
        id: "props_needed",
        label: "Props needed",
        type: "text",
        required: true,
        help: "Anything the crew has to carry on.",
        maxLength: 60,
      },
      { id: "arrival", label: "Arrival day", type: "select", required: true, options: ["Friday", "Saturday"] },
      { id: "vans", label: "Vans arriving", type: "number", required: false },
      { id: "notes", label: "Anything else", type: "longtext", required: false },
      { id: "photo_ok", label: "Happy to be photographed", type: "checkbox", required: false },
    ],
  },
};

const seed = (): SeededComp => {
  const config = tmp("fields.json");
  writeFileSync(config, JSON.stringify(CONFIG));

  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

test("a board asks its own questions, the server enforces them, and the board reads the answers", async ({
  browser,
}) => {
  const comp = seed();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/register/${ORG}/${COMP}`);

  // The board's questions are on the form, with the help text it wrote.
  await expect(page.getByTestId("custom-fields")).toBeVisible();
  await expect(page.getByText("Anything the crew has to carry on.")).toBeVisible();

  await page.getByLabel("Team name").fill("Custom Crew");
  await page.getByLabel("Contact name").fill("Priya Raman");
  await page.getByLabel("Contact email").fill("priya@example.com");
  await page.getByLabel("Roster size").fill("18");
  await page.getByLabel("Accept the waiver").check();

  // Answer the optional questions and leave a *required* one blank. The browser would refuse to
  // submit that on its own, so the attribute is stripped first: the refusal being asserted is the
  // server's, and the page's own validation is a courtesy to an honest applicant.
  await page.getByLabel("Vans arriving").fill("3");
  await page.getByLabel("Anything else").fill("We need ten minutes to set up.");
  await page.getByLabel("Happy to be photographed").check();
  await page.getByLabel("Arrival day").selectOption("Saturday");

  const props = page.getByLabel("Props needed");
  await props.evaluate((el) => el.removeAttribute("required"));
  await page.getByRole("button", { name: "Apply" }).click();

  // Named the way the applicant read it — never by the id it is stored under.
  await expect(page.getByTestId("apply-error")).toContainText("Props needed is required.");
  await expect(page.getByTestId("apply-error")).not.toContainText("props_needed");

  // And the refusal costs them nothing they typed, custom answers included. React blanks an
  // uncontrolled form once its action has run, so these come back or they are gone.
  await expect(page.getByLabel("Team name")).toHaveValue("Custom Crew");
  await expect(page.getByLabel("Vans arriving")).toHaveValue("3");
  await expect(page.getByLabel("Anything else")).toHaveValue("We need ten minutes to set up.");
  await expect(page.getByLabel("Arrival day")).toHaveValue("Saturday");
  await expect(page.getByLabel("Happy to be photographed")).toBeChecked();

  await page.getByLabel("Props needed").fill("One ladder");
  await page.getByRole("button", { name: "Apply" }).click();

  const applied = page.getByTestId("applied");
  await expect(applied).toBeVisible();
  const bidCode = (await applied.textContent())?.match(/T-\d+/)?.[0] ?? "";
  expect(bidCode).toMatch(/^T-\d+$/);

  // The board reads the answers under the words it asked them in, on the screen where it decides
  // whether to accept the team.
  const board = await context.newPage();
  await board.goto(`/board/${comp.boardToken}/roster`);

  await expect(board.getByTestId(`roster-answer-${bidCode}-props_needed`)).toContainText(
    "Props needed: One ladder",
  );
  await expect(board.getByTestId(`roster-answer-${bidCode}-arrival`)).toContainText(
    "Arrival day: Saturday",
  );
  await expect(board.getByTestId(`roster-answer-${bidCode}-vans`)).toContainText("Vans arriving: 3");
  await expect(board.getByTestId(`roster-answer-${bidCode}-photo_ok`)).toContainText(
    "Happy to be photographed: yes",
  );

  // A seeded team never applied, so it answered nothing. That is a gap, not a blank.
  await expect(board.getByTestId("roster-answer-A-1-props_needed")).toHaveCount(0);

  await context.close();
});

test("a select cannot be answered with something it never offered", async ({ browser }) => {
  seed();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/register/${ORG}/${COMP}`);

  await page.getByLabel("Team name").fill("Injected Crew");
  await page.getByLabel("Contact name").fill("Priya Raman");
  await page.getByLabel("Contact email").fill("priya@example.com");
  await page.getByLabel("Roster size").fill("18");
  await page.getByLabel("Props needed").fill("None");
  await page.getByLabel("Accept the waiver").check();

  // Add an option the board never authored. A select is a closed question, and the config is the
  // only thing that can say what it offered — so the answer has to be checked against it, not
  // against whatever the browser happened to submit.
  await page.getByLabel("Arrival day").evaluate((el) => {
    const option = document.createElement("option");
    option.value = "Thursday";
    el.appendChild(option);
    (el as HTMLSelectElement).value = "Thursday";
  });
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.getByTestId("apply-error")).toContainText(
    "Arrival day has to be one of the options offered.",
  );
  await expect(page.getByTestId("applied")).toHaveCount(0);

  await context.close();
});
