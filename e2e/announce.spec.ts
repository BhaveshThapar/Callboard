import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

/**
 * The board's own voice — the first **broadcast** send in the product.
 *
 * Everything else the engine sends is transactional: a bill, a receipt, a credential, all owed to
 * somebody whether they want them or not. An announcement is a board choosing to speak, which is the
 * category a person may opt out of — so this is the spec that proves `people.unsubscribed_at` is
 * load-bearing rather than a column with a writer and no consequence.
 */

type SeededComp = { boardToken: string };

const ORG = "announce-e2e-org";
const COMP = "announce-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const contact = (name: string, email: string) => ({ name, email });

const CONFIG = {
  org: { name: "Announce E2E Org", slug: ORG },
  comp: { name: "Announce E2E 2027", slug: COMP, compDate: "2027-03-06", status: "open" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [
    { name: "In One", bidCode: "M-1", status: "competing", contact: contact("Ada", "ada@example.com") },
    { name: "In Two", bidCode: "M-2", status: "accepted", contact: contact("Ben", "ben@example.com") },
    // The three that must not hear it. Each has a contact, so being skipped is about status alone.
    { name: "Waiting", bidCode: "M-3", status: "waitlisted", waitlistRank: 1, contact: contact("Cy", "cy@example.com") },
    { name: "Applied", bidCode: "M-4", status: "applied", contact: contact("Dee", "dee@example.com") },
    { name: "Gone", bidCode: "M-5", status: "dropped", contact: contact("Eve", "eve@example.com") },
  ],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Announce Chair" }],
};

const seed = (): SeededComp => {
  const config = tmp("announce.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const comms = (...args: string[]): string =>
  execFileSync("bunx", ["tsx", "e2e/support/comms.ts", ...args], { encoding: "utf8" }).trim();

const announce = async (
  page: Page,
  token: string,
  subject: string,
  body: string,
): Promise<void> => {
  await page.goto(`/board/${token}/roster`);
  await expect(page.getByTestId("announce")).toBeVisible();
  await page.getByTestId("announce-subject").fill(subject);
  await page.getByTestId("announce-body").fill(body);
  await page.getByTestId("announce-submit").click();
};

test("an announcement reaches the teams that are in, and nobody else", async ({ page }) => {
  const comp = seed();

  await announce(page, comp.boardToken, "Load-in moved to 7:30", "Doors at 7:30. Park in Lot 4.");
  await expect(page.getByTestId("announce-message")).toContainText("Sent to 2 teams");

  // Not the waitlist, not an applicant, and above all not the team that dropped.
  expect(comms("outbox", COMP)).toBe(
    ["announcement.sent ada@example.com queued", "announcement.sent ben@example.com queued"].join(
      "\n",
    ),
  );
});

test("the same announcement is never sent to a team twice", async ({ page }) => {
  const comp = seed();

  await announce(page, comp.boardToken, "Bus times", "The bus leaves at seven.");
  await expect(page.getByTestId("announce-message")).toContainText("Sent to 2 teams");

  await announce(page, comp.boardToken, "Bus times", "The bus leaves at seven.");
  await expect(page.getByTestId("announce-message")).toContainText("already had this exact message");
  expect(comms("count", COMP)).toBe("2");

  // Changing a word makes it a different announcement, which is how a board corrects itself.
  await announce(page, comp.boardToken, "Bus times", "The bus leaves at eight.");
  await expect(page.getByTestId("announce-message")).toContainText("Sent to 2 teams");
  expect(comms("count", COMP)).toBe("4");
});

/**
 * The split, driven end to end. A broadcast to somebody who opted out **bounces with a reason**; a
 * transactional message to the same person is delivered, because a bill is owed whether or not the
 * person wants to hear from the board.
 */
test("unsubscribing stops announcements and does not stop a bill", async ({ page }) => {
  const comp = seed();

  comms("unsubscribe-email", COMP, "ada@example.com");

  // Queued for **both**: suppression is the sweep's decision, taken at send rather than at enqueue,
  // because somebody may unsubscribe in between and the queued row is the record that a board meant
  // to tell them something.
  await announce(page, comp.boardToken, "Load-in", "Doors at 7:30.");
  await expect(page.getByTestId("announce-message")).toContainText("Sent to 2 teams");
  expect(comms("count", COMP)).toBe("2");

  // One claimed and sent, one suppressed before it was ever claimed.
  expect(comms("sweep", COMP)).toBe("1 1 0 1");
  expect(comms("outbox", COMP)).toBe(
    ["announcement.sent ada@example.com bounced", "announcement.sent ben@example.com sent"].join(
      "\n",
    ),
  );

  // And the same person still gets a transactional one. This is the half that would be easy to get
  // wrong by suppressing on the recipient instead of on the kind — a board that could not bill
  // somebody because they muted announcements would be a worse product than one with no mute at all.
  comms("queue-to", COMP, "ada@example.com");
  expect(comms("sweep", COMP)).toBe("1 1 0 0");
  expect(comms("outbox", COMP)).toContain("dues.reminder ada@example.com sent");
});
