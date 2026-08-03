import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * C2's one guarantee, driven against a real database: **a message sends once.**
 *
 * The unit tests cover the machine — what may follow what, when a row is due, when a claim has gone
 * stale. None of them can reach the thing that actually protects a person's inbox, which is a unique
 * index. `messages_comp_dedupe_unique` is what refuses the second enqueue, and only Postgres can
 * refuse it: the ask and the insert are two acts on neon-http, exactly as they are for a forked
 * `tab_runs` chain and a twice-ended deposit.
 *
 * The transport records instead of sending, which is not a mock — the outbox is the product and only
 * the last hop differs (ADR-0020). It is also what makes this safe to run at all: a fixture holds
 * real-looking addresses, and a test that could email them is a test nobody should write.
 */

const ORG = "comms-e2e-org";
const COMP = "comms-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Comms E2E Org", slug: ORG },
  comp: { name: "Comms E2E 2027", slug: COMP, compDate: "2027-03-06", status: "open" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [{ name: "Accepted Beta", bidCode: "M-2", status: "accepted", rosterSize: 20, rooms: 5 }],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Comms Chair", email: "chair@example.com" }],
  feeSchedule: {
    perDancerCents: 7000,
    perRoomCents: 14000,
    depositCents: 10000,
    lateFeeCents: 2500,
    lateAfter: "2099-01-01",
  },
};

const seed = (): void => {
  const config = tmp("comms.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config], { stdio: "pipe" });
};

const comms = (...args: string[]): string =>
  execFileSync("bunx", ["tsx", "e2e/support/comms.ts", ...args], { encoding: "utf8" }).trim();

test("a reminder queued twice is queued once, and the database is what says so", () => {
  seed();

  // Two enqueues, one key. The first wins; the second is refused by the index rather than by a
  // check the code remembered to write.
  expect(comms("queue-twice", COMP, "dues:2027-02")).toBe("queued:duplicate");
  expect(comms("count", COMP)).toBe("1");

  // And it sends exactly once.
  expect(comms("sweep", COMP)).toBe("1 1 0 0");
  expect(comms("sent", COMP)).toBe("1");
  expect(comms("states", COMP)).toBe("queued,sending,sent");
});

/**
 * The failure that will actually happen: a scheduled job runs again before the first tick's work is
 * finished, or two ticks overlap. The claim is one guarded UPDATE, so the second sweep finds nothing
 * claimable — and the message is not sent a second time.
 */
test("a second sweep sends nothing, because the claim is the serialization point", () => {
  seed();

  comms("queue-twice", COMP, "dues:2027-03");
  expect(comms("sweep", COMP)).toBe("1 1 0 0");

  // Nothing claimed, nothing sent. A terminal message is not a candidate.
  expect(comms("sweep", COMP)).toBe("0 0 0 0");
  expect(comms("sent", COMP)).toBe("1");
  expect(comms("states", COMP)).toBe("queued,sending,sent");
});

/**
 * `people.unsubscribed_at` suppresses broadcast and **not** transactional, and the split is at the
 * schema rather than in a caller's judgement — blurring it is how a product ends up sending
 * announcements under a receipt's legal cover.
 */
test("an unsubscribe stops an announcement and does not stop a dues reminder", () => {
  seed();
  comms("unsubscribe", COMP);

  comms("queue-broadcast", COMP, "announce:1");
  comms("sweep", COMP);
  // Suppressed at send rather than at enqueue: the queued row is the record that a board meant to
  // say something, and a person may unsubscribe between the two.
  expect(comms("head", COMP)).toBe("bounced");

  comms("queue-twice", COMP, "dues:2027-04");
  expect(comms("sweep", COMP)).toBe("1 1 0 0");
  expect(comms("head", COMP)).toBe("sent");
});

/**
 * A person with no address is bounced, not silently skipped and not thrown over.
 *
 * Found by accident: a fixture picked an emailless board member and every assertion in this file
 * quietly became an assertion about suppression instead of about sending. The behaviour was right;
 * nothing was testing it on purpose. A board that invites somebody by name and never gets an address
 * for them is ordinary, and "we tried and there was nowhere to send it" has to be in the record.
 */
test("a message to somebody with no address bounces, and says why", () => {
  seed();

  expect(comms("queue-unreachable", COMP, "dues:noaddress")).toBe("queued");
  expect(comms("sweep", COMP)).toBe("0 0 0 1");
  expect(comms("head", COMP)).toBe("bounced");
  // Bounced rather than failed: no number of retries produces an address.
  expect(comms("states", COMP)).toBe("queued,bounced");
});

test("the cron endpoint refuses anybody without the secret", async ({ request }) => {
  // No `CRON_SECRET` in this environment, so the route is off entirely -- which is the safe default
  // rather than an open endpoint that sends email.
  const bare = await request.get("/api/cron/send");
  expect([404, 503]).toContain(bare.status());

  const guessed = await request.get("/api/cron/send", {
    headers: { authorization: "Bearer not-the-secret" },
  });
  expect([404, 503]).toContain(guessed.status());
  expect(await guessed.text()).not.toContain("claimed");
});
