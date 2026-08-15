import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

/**
 * A11's on-ramp, as far as it can be driven without a Google account.
 *
 * A live OAuth handshake cannot run here — it needs a real Google project, a consent screen and a
 * human clicking Allow. What *can* be driven is the half this repo has historically got wrong, which
 * is not the integration but the **reachability**: whether a board can get to the screen at all, and
 * whether an unconfigured deployment says so instead of failing somewhere confusing.
 *
 * The Google call is the part a mock would prove nothing about, and the link is the part that has
 * actually broken. **But that argument was over-applied once**, and this file is where it showed:
 * it stopped at reachability for all of A11, when only `listFolder` and `previewImport` talk to
 * Google. `importTeams` takes candidates that are already parsed — so the one function in the
 * feature that *inserts rows* shipped with no test at all, and the two claims the map leans on
 * hardest went unasserted: that an imported team lands `applied` and therefore owes nothing, and
 * that a nameless contact row cannot rename a person who already exists. Those are below,
 * driven through `e2e/support/import.ts` for the reason `comms.ts` exists.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "import-e2e-org";
const COMP = "import-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Import E2E Org", slug: ORG },
  comp: { name: "Import E2E 2027", slug: COMP, compDate: "2027-03-06", status: "open" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [{ name: "Existing Team", bidCode: "M-2", status: "accepted", rosterSize: 20 }],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Import Chair" }],
  // Present so "importing bills nobody" is an assertion rather than a tautology: with a schedule the
  // seeded `accepted` team carries charges, so a count that does not move is evidence.
  feeSchedule: { perDancerCents: 7000, perRoomCents: 14000, depositCents: 10000, lateFeeCents: 0 },
};

const seed = (): SeededComp => {
  const config = tmp("import.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const drive = (...args: string[]): string =>
  execFileSync("bunx", ["tsx", "e2e/support/import.ts", ...args], { encoding: "utf8" }).trim();

test("a board can reach the importer from the roster it would import into", async ({ page }) => {
  const comp = seed();

  await page.goto(`/board/${comp.boardToken}/roster`);
  const link = page.getByTestId("roster-import-link");
  await expect(link).toBeVisible();

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/app/${ORG}/${COMP}/import$`));
  await expect(page.getByText("From Google Drive")).toBeVisible();
});

/**
 * Without `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `DRIVE_TOKEN_KEY` the screen says so.
 *
 * The last of those is the one worth asserting: without a sealing key a refresh token could only be
 * stored in the clear, so connecting is **refused rather than downgraded**. A deployment that
 * quietly kept plaintext tokens would be the worst available default, and this is what makes the
 * refusal visible instead of theoretical.
 */
test("an unconfigured deployment says so rather than starting a flow it cannot finish", async ({
  page,
}) => {
  const comp = seed();

  await page.goto(`/board/${comp.boardToken}/import`);
  await expect(page.getByTestId("drive-unconfigured")).toBeVisible();
  await expect(page.getByTestId("drive-unconfigured")).toContainText("DRIVE_TOKEN_KEY");

  // No connect button is offered, because pressing it could not work.
  await expect(page.getByTestId("drive-connect")).toHaveCount(0);
  await expect(page.getByTestId("drive-account")).toHaveCount(0);
});

/**
 * The connect route proves board access *before* Google is involved, so a stranger cannot start a
 * flow that would end with a token stored against somebody else's org.
 */
test("the connect route refuses somebody with no standing at the comp", async ({ page }) => {
  seed();

  // No board cookie in this context at all.
  const response = await page.goto(`/api/drive/connect?org=${ORG}&comp=${COMP}`);
  // It redirects to the dashboard rather than to Google, and never reaches accounts.google.com.
  expect(page.url()).not.toContain("accounts.google.com");
  expect(response?.status()).toBeLessThan(500);
});

test("the importer is not offered to a captain, whose window holds one team", async ({ page }) => {
  const comp = seed();

  await page.goto(`/board/${comp.boardToken}/roster`);
  await expect(page.getByTestId("roster-import-link")).toBeVisible();

  // The captain's shell has one tab and no roster, so there is nothing here that links an importer.
  await page.context().clearCookies();
  const response = await page.goto(`/app/${ORG}/${COMP}/import`);
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByTestId("drive-preview")).toHaveCount(0);
});

/**
 * The claim the whole feature is sequenced on: importing a roster creates **no obligation**.
 *
 * `applied` is not in `BILLABLE_STATUSES`, so accepting each team through `setTeamStatus` stays the
 * only act that bills. If the importer inserted `accepted` rows there would be two paths in this
 * product deciding what a team owes, and the second one would have no transaction behind it.
 *
 * The two assertions catch different things and neither is redundant. The **status** is what fails
 * if the importer starts inserting `accepted` — verified by mutation, and the charge count does
 * *not* move in that case, because such an importer would create a team that is billable and bill
 * it nowhere, which is the orphan A3 exists to prevent. The **charge count** is what fails if the
 * importer ever grows a billing call of its own; the comp carries a fee schedule so the seeded
 * accepted team has charges, and a count that holds is evidence rather than an empty table.
 */
test("an imported team lands applied, and applied owes nothing", () => {
  const comp = seed();

  const before = drive("charges", COMP);
  expect(Number(before)).toBeGreaterThan(0);

  expect(drive("run", comp.boardToken, "basic")).toBe("2 0");

  expect(drive("teams", COMP)).toBe(
    [
      "Existing Team accepted -",
      "Imported Alpha applied asha@example.com",
      "Imported Beta applied -",
    ].join("\n"),
  );

  expect(drive("charges", COMP), "importing billed somebody").toBe(before);
});

/**
 * A row the parser flagged is skipped rather than inserted, and the board is told the count.
 *
 * An importer that quietly ingested 34 of 36 teams is the failure this product is sold against, so
 * the number that did not make it has to be reported — and the row that *would* have doubled a
 * team must not be in the roster twice.
 */
test("a flagged row is skipped, and says so, rather than landing in the roster", () => {
  const comp = seed();

  expect(drive("run", comp.boardToken, "problems")).toBe("1 2");
  expect(drive("teams", COMP)).toBe(["Existing Team accepted -", "Imported Gamma applied -"].join("\n"));
});

/**
 * The guard the code spends a paragraph on, which nothing exercised.
 *
 * A sheet with an email column and no captain column would otherwise rename every person it matched
 * to their own address — and `people` is the row an account, a board membership and every message
 * recipient hang off, with no history to undo it. Registration cannot cause this because it refuses
 * a blank contact name; the address-as-name fallback belongs to this importer alone, so the guard
 * does too.
 */
test("a nameless contact row does not rename the person it matches", () => {
  const comp = seed();

  drive("run", comp.boardToken, "basic");
  expect(drive("person", COMP, "asha@example.com")).toBe("Asha Rao");

  // Same address, no name in the sheet. Finds her, and leaves her name alone.
  drive("run", comp.boardToken, "email-only");
  expect(drive("person", COMP, "asha@example.com"), "renamed, or duplicated").toBe("Asha Rao");
});
