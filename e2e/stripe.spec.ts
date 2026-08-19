import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * A5 — the webhook, which is the only part of Stripe that can put a row in the ledger.
 *
 * The claim worth an e2e is **replay**: Stripe redelivers until it gets a 2xx and again after any
 * 5xx, so a duplicate is the ordinary path the first time a deploy is slow. An endpoint that is not
 * idempotent double-records a payment, which is the ~$5,000 gap of PRD §14 arriving through the
 * feature built to close it.
 *
 * The signature is exercised for real — signed with the same HMAC Stripe uses — because a unit test
 * proves `verifySignature` refuses and only this proves the **route** refuses.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "stripe-e2e-org";
const COMP = "stripe-e2e-comp";
/**
 * The same value the route is given, read from the environment rather than repeated — the workflow
 * sets it and this signs with it, and a literal in both places is two definitions of one string that
 * drift on the first edit. The default keeps `bun run e2e` working on a laptop without exporting it.
 *
 * It is a **fixture, not a secret**: a real `whsec_…` here would be worse than useless, because this
 * file could not then produce a valid signature and every assertion would pass for the wrong reason.
 */
const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_e2e_secret";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Stripe E2E Org", slug: ORG },
  comp: { name: "Stripe E2E 2027", slug: COMP, compDate: "2027-03-06", status: "live" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [{ name: "Stripe Alpha", bidCode: "S-1", status: "accepted", rosterSize: 18 }],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Stripe Chair" }],
  feeSchedule: { perDancerCents: 7000, perRoomCents: 0, depositCents: 10000, lateFeeCents: 0 },
};

const seed = (): SeededComp => {
  const config = tmp("stripe.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

/**
 * A per-run prefix for every event id, and it is not cosmetic.
 *
 * `stripe_events` is the replay guard, so a row is **meant** to outlive the thing that created it —
 * and a row for an *unknown* account carries a null `comp_id`, so it survives the reseed every spec
 * in this directory performs. A fixed `evt_unknown` therefore passed on a fresh CI database and then
 * failed on the next run against the same one, reporting `duplicate: true` where the test expected
 * `handled: false`. The guard was working; the test assumed a database nobody had used yet.
 *
 * The replay test still reuses **one** id deliberately, because that is the property it is about.
 */
const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const signed = (payload: string): string => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${payload}`).digest("hex")}`;
};

const post = async (
  request: import("@playwright/test").APIRequestContext,
  payload: string,
  signature: string | null,
) =>
  request.post("/api/stripe/webhook", {
    headers: {
      "content-type": "application/json",
      ...(signature ? { "stripe-signature": signature } : {}),
    },
    data: payload,
    failOnStatusCode: false,
  });

const intentEvent = (id: string, teamId: string, amountCents: number, account: string): string =>
  JSON.stringify({
    id,
    type: "payment_intent.succeeded",
    account,
    data: { object: { id: `pi_${id}`, amount_received: amountCents, metadata: { teamId } } },
  });

test("an unsigned or wrongly-signed webhook is refused, and writes nothing", async ({ request }) => {
  seed();
  const payload = intentEvent(`evt_unsigned-${RUN}`, "00000000-0000-0000-0000-000000000000", 5000, "acct_x");

  const unsigned = await post(request, payload, null);
  expect(unsigned.status()).toBe(400);

  const wrong = await post(
    request,
    payload,
    `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`,
  );
  expect(wrong.status()).toBe(400);

  // The body being edited after signing is the same refusal, and it is the one that matters:
  // the amount lives in the body.
  const good = signed(payload);
  const tampered = await post(request, payload.replace("5000", "500000"), good);
  expect(tampered.status()).toBe(400);
});

test("a redelivered event is answered 200 and recorded once", async ({ request }) => {
  seed();
  const payload = intentEvent(`evt_replay-${RUN}`, "00000000-0000-0000-0000-000000000000", 5000, "acct_none");
  const signature = signed(payload);

  const first = await post(request, payload, signature);
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({ received: true });

  // Stripe retries. The second must not be an error -- a non-2xx makes it retry the thing it has
  // already done -- and must not write a second row.
  const second = await post(request, payload, signature);
  expect(second.status()).toBe(200);
  expect(await second.json()).toMatchObject({ received: true, duplicate: true });
});

test("an event for an account this deployment does not know records nothing but is not lost", async ({
  request,
}) => {
  seed();
  const payload = intentEvent(`evt_unknown-${RUN}`, "00000000-0000-0000-0000-000000000000", 5000, "acct_ghost");
  const response = await post(request, payload, signed(payload));

  expect(response.status()).toBe(200);
  // Recorded in `stripe_events` and deliberately not acted on: a later question about what arrived
  // has an answer, which is the difference between ignoring an event and dropping it.
  expect(await response.json()).toMatchObject({ received: true, handled: false });
});

test("a signature from outside the tolerance window is refused, so a captured request is not a key", async ({
  request,
}) => {
  seed();
  const payload = intentEvent(`evt_old-${RUN}`, "00000000-0000-0000-0000-000000000000", 5000, "acct_x");
  const old = Math.floor(Date.now() / 1000) - 3600;
  const stale = `t=${old},v1=${createHmac("sha256", SECRET).update(`${old}.${payload}`).digest("hex")}`;

  const response = await post(request, payload, stale);
  expect(response.status()).toBe(400);
});
