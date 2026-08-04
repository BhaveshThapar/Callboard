import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

/**
 * A10 — the reminder a board actually presses.
 *
 * The outbox shipped complete, tested and wired to cron with **no product caller**: `sweep` ran on a
 * schedule over a queue nothing could put anything into. That is the defect this repo has recorded
 * five times now (`recordPayment`, `advanceDeposit`, `listDepositsForBoard`, `releaseAllocation`),
 * and it is the reason this spec clicks the button rather than calling `enqueue` — `e2e/comms.spec.ts`
 * proves the *guarantee* from outside the product, and this proves the product reaches it.
 *
 * The transport records rather than sends, so nothing leaves the machine.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "dues-e2e-org";
const COMP = "dues-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Dues E2E Org", slug: ORG },
  comp: { name: "Dues E2E 2027", slug: COMP, compDate: "2027-03-06", status: "open" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [
    // 20 x $70 + 5 x $140 + $100 deposit = $2,200.00
    {
      name: "Owes With Captain",
      bidCode: "M-2",
      status: "accepted",
      rosterSize: 20,
      rooms: 5,
      contact: { name: "Meera Iyer", email: "meera@example.com" },
    },
    // 10 x $70 + 2 x $140 + $100 = $1,080.00
    {
      name: "Also Owes",
      bidCode: "M-3",
      status: "accepted",
      rosterSize: 10,
      rooms: 2,
      contact: { name: "Rohan Kapoor", email: "rohan@example.com" },
    },
    // Owes exactly as much, and there is nobody to send it to. The point of the third row.
    { name: "No Captain", bidCode: "M-4", status: "accepted", rosterSize: 10, rooms: 2 },
  ],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Dues Chair" }],
  // No late fee and no `lateAfter`: the parser refuses a date with no fee behind it, and this spec
  // is about who gets chased rather than about what they owe.
  feeSchedule: { perDancerCents: 7000, perRoomCents: 14000, depositCents: 10000, lateFeeCents: 0 },
};

const seed = (): SeededComp => {
  const config = tmp("dues.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const comms = (...args: string[]): string =>
  execFileSync("bunx", ["tsx", "e2e/support/comms.ts", ...args], { encoding: "utf8" }).trim();

test("a board chases everyone who owes, and is told who it could not reach", async ({ page }) => {
  const comp = seed();

  await page.goto(`/board/${comp.boardToken}/money`);
  await expect(page.getByTestId("dues-reminders")).toBeVisible();

  // Three teams owe; two of them can be reached.
  await expect(page.getByTestId("remind-all")).toContainText("(3)");
  await page.getByTestId("remind-all").click();

  const message = page.getByTestId("dues-message");
  await expect(message).toBeVisible();
  await expect(message).toContainText("2 reminders queued");

  // The unreachable team is *named*, not silently dropped. "We reminded two of three" and "everybody
  // was reminded" are different facts, and only one of them is true.
  await expect(message).toContainText("No Captain");

  // And the outbox agrees, addressed to the right captains for the right numbers.
  expect(comms("count", COMP)).toBe("2");
  expect(comms("recipients", COMP)).toBe(
    ["dues.reminder meera@example.com $2,200.00", "dues.reminder rohan@example.com $1,080.00"].join(
      "\n",
    ),
  );
});

/**
 * The realistic second click: a treasurer who is not sure the first one worked. `enqueue` reports
 * `duplicate`, the screen says what actually happened, and no captain is billed twice.
 */
test("clicking again queues nothing, because one team gets one reminder a month", async ({
  page,
}) => {
  const comp = seed();

  await page.goto(`/board/${comp.boardToken}/money`);
  await page.getByTestId("remind-all").click();
  await expect(page.getByTestId("dues-message")).toContainText("2 reminders queued");

  await page.getByTestId("remind-all").click();
  const message = page.getByTestId("dues-message");
  await expect(message).toContainText("already sent this month");
  await expect(message).not.toContainText("2 reminders queued");

  // Two messages, not four. The index is what refuses the second pair, not the button.
  expect(comms("count", COMP)).toBe("2");
});

test("one team can be chased on its own, without mailing the rest of the comp", async ({ page }) => {
  const comp = seed();

  await page.goto(`/board/${comp.boardToken}/money`);
  await page
    .getByTestId("remind-team")
    .selectOption({ label: "Also Owes (M-3) — $1,080.00" });
  await page.getByTestId("remind-one").click();

  await expect(page.getByTestId("dues-message")).toContainText("1 reminder queued");
  expect(comms("count", COMP)).toBe("1");
  expect(comms("recipients", COMP)).toBe("dues.reminder rohan@example.com $1,080.00");
});

/**
 * The defect that made A10 decorative for exactly the boards it exists for.
 *
 * `teams.contact_person_id` is written by the registration form, and setup is founder-run by design
 * (PRD §12) — so a founding partner's roster is *seeded*, carries no contact on any team, and the
 * button reported "nobody could be reminded" for every one of them. It would have looked finished
 * and done nothing.
 *
 * P1 already built the other door: a captain who accepted an invitation is the same human. This is
 * the only test that proves it, because the unit tests can prove the planner *accepts* a map and
 * nothing but a browser can prove the action *builds the right one* — the membership query is where
 * this would break, and it is not reachable from a pure test.
 */
test("a captain who accepted an invitation can be chased, with nothing registered", async ({
  page,
}) => {
  const comp = seed();

  // M-4 owes exactly what M-3 does and has no registered contact: the seeded-roster case.
  await page.goto(`/board/${comp.boardToken}/money`);
  await page.getByTestId("remind-all").click();
  await expect(page.getByTestId("dues-message")).toContainText("No Captain");
  expect(comms("count", COMP)).toBe("2");

  // The board invites its captain, and they set a password.
  await page.goto(`/board/${comp.boardToken}/people`);
  await page.getByTestId("invite-name").fill("Nadia Sheikh");
  await page.getByTestId("invite-email").fill("nadia@example.com");
  await page.getByTestId("invite-role").selectOption("captain");
  const option = page.locator('[data-testid="invite-team"] option').filter({ hasText: "No Captain" });
  await page.getByTestId("invite-team").selectOption((await option.first().getAttribute("value")) ?? "");
  await page.getByTestId("invite-submit").click();

  const text = (await page.getByTestId("invite-message").textContent()) ?? "";
  const link = text.match(/\/invite\/([\w-]+)/);
  expect(link, `no invitation link in: ${text}`).toBeTruthy();

  await page.goto(`/invite/${link?.[1]}`);
  await page.getByTestId("credential-password").fill("a passphrase long enough to pass");
  await page.getByTestId("credential-confirm").fill("a passphrase long enough to pass");
  await page.getByTestId("credential-submit").click();
  await expect(page.getByTestId("my-comps")).toBeVisible();

  // Now the team the board could not reach is reachable, and nothing about the roster changed.
  await page.goto(`/board/${comp.boardToken}/money`);
  await page.getByTestId("remind-all").click();
  const message = page.getByTestId("dues-message");
  await expect(message).toContainText("1 reminder queued");
  await expect(message).not.toContainText("No Captain");

  expect(comms("count", COMP)).toBe("3");
  expect(comms("recipients", COMP)).toContain("dues.reminder nadia@example.com $1,080.00");
});

/**
 * The whole path, end to end: the board presses a button and the engine hands two messages to a
 * transport. Everything before this test proves the queue is correct; this proves it drains.
 */
test("what the button queues is what the sweep sends", async ({ page }) => {
  const comp = seed();

  await page.goto(`/board/${comp.boardToken}/money`);
  await page.getByTestId("remind-all").click();
  await expect(page.getByTestId("dues-message")).toContainText("2 reminders queued");

  expect(comms("sweep", COMP)).toBe("2 2 0 0");
  expect(comms("sent", COMP)).toBe("2");
});
