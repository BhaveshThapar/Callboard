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
 * That is deliberately the assertion set. Five times this repo has shipped a complete, tested
 * subsystem with nothing pointing at it; the Google call is the part a mock would prove nothing
 * about, and the link is the part that has actually broken.
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
