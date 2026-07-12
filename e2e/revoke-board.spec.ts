import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * A leaked board link can be killed.
 *
 * `board_assignments.revoked_at` has been *read* by `resolveBoardActor` since ADR-0007 and written
 * by nothing, so until now a board link that leaked could still lock, override and deduct under a
 * named person's attribution, and could only be killed from the database. ADR-0010 recorded it as
 * the one live hole among the three it deferred.
 *
 * Two properties matter beyond "it revokes", and both are asserted here.
 *
 * It stays available after the lock, where judge revocation does not — a board link is the one that
 * can still override a locked result, so the moment a leaked one matters most is exactly the moment
 * the judge rule would have forbidden killing it.
 *
 * And the last live link cannot be revoked. Nothing in this product mints a link (ADR-0011), so a
 * board that revoked its way to zero would be locked out of its own comp mid-night with no way back
 * short of a reseed, which destroys the scores.
 *
 * The demo seeds a single board member, so this uses the two-member example config.
 */

type SeededComp = {
  compId: string;
  boardToken: string;
  board: { name: string; token: string }[];
};

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

/** The example config carries two board members; the demo carries one. */
const seedTwoBoardMembers = (): SeededComp => {
  const config = tmp("comp.json");
  writeFileSync(config, readFileSync("comp-config.example.json", "utf8"));

  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

/** Targeted by name: the sidebar sorts the board by name, so an index would pick the wrong row. */
const revokeControlFor = (page: import("@playwright/test").Page, name: string) =>
  page.locator(`[data-board-member="${name}"]`).getByRole("button", { name: "Revoke link" });

test("a board member can kill another board link, but never the last one", async ({ browser }) => {
  const comp = seedTwoBoardMembers();
  expect(comp.board).toHaveLength(2);

  const [chair, director] = comp.board;

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/board/${chair!.token}`);

  // Both links are live, so both are revocable and the board can see who holds what.
  await expect(page.getByText(chair!.name).first()).toBeVisible();
  await expect(page.getByText(director!.name).first()).toBeVisible();

  // The director's link leaks. Kill it.
  await revokeControlFor(page, director!.name).click();
  await expect(page.getByText("That board link no longer opens.")).toBeVisible();

  // It is dead where it counts: the link itself no longer resolves.
  const leaked = await browser.newContext();
  const leakedPage = await leaked.newPage();
  const response = await leakedPage.goto(`/board/${director!.token}`);
  expect(response?.status()).toBe(404);
  await leaked.close();

  // The chair's own link is now the only one left, so the product stops offering to revoke it --
  // and refuses if asked anyway, because the button is not the guarantee.
  await page.reload();
  await expect(page.locator('[data-testid^="revoke-board-"]')).toHaveCount(0);

  await context.close();
});

test("the last board link is refused by the server, not merely hidden by the page", async ({
  browser,
}) => {
  const comp = seedTwoBoardMembers();
  const [chair, director] = comp.board;

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/board/${chair!.token}`);

  // The chair's own revoke control, captured while a second link still exists and it is offered.
  const revokeSelf = revokeControlFor(page, chair!.name);
  await expect(revokeSelf).toBeVisible();

  // Meanwhile, in another tab, the director revokes their own link. The chair's page does not know.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(`/board/${director!.token}`);
  await revokeControlFor(otherPage, director!.name).click();
  await expect(otherPage.getByText("Your own board link no longer opens")).toBeVisible();
  await other.close();

  // The chair's page is now stale: it still shows a button that must not work. Click it.
  await revokeSelf.click();
  await expect(
    page.getByText("This is the last working board link. Revoking it would lock the board out"),
  ).toBeVisible();

  // And the chair's link still opens, which is the whole point of refusing.
  await page.reload();
  await expect(page.getByRole("heading", { name: /Live standings|Final placements/ })).toBeVisible();

  await context.close();
});
