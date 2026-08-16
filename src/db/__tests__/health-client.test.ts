import { describe, expect, it } from "vitest";
import { fetchHealth } from "../health-client";

const payload = {
  migrations: { applied: 15, expected: 15 },
  config: {
    sending: "off",
    sendingMissing: ["RESEND_API_KEY", "COMMS_FROM"],
    cron: false,
    baseUrl: true,
    drive: "off",
    driveMissing: [],
    sealing: "off",
    sealingKeyBytes: null,
  },
};

/** Counts calls, so "did not retry" is proved by arithmetic rather than by a stopwatch. */
const stub = (responses: (Response | Error)[]) => {
  const calls: string[] = [];
  const send = (async (url: string | URL | Request) => {
    calls.push(String(url));
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next as Response;
  }) as unknown as typeof fetch;
  return { send, calls };
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fetchHealth", () => {
  it("asks the health route under the host it was given", async () => {
    const { send, calls } = stub([json(payload)]);
    const answer = await fetchHealth("https://example.test", 3, send);

    expect(answer.ok).toBe(true);
    expect(calls).toEqual(["https://example.test/api/health"]);
  });

  it("does not double the slash when the host has a trailing one", async () => {
    const { send, calls } = stub([json(payload)]);
    await fetchHealth("https://example.test/", 3, send);
    expect(calls[0]).toBe("https://example.test/api/health");
  });

  /**
   * **The no-retry rule, proved by counting.** A 404 means the route is not deployed, which during
   * this route's own first rollout is exactly the state to fail loudly on — retrying would spend
   * twenty seconds arriving at the same answer while reading like a flake.
   */
  it("never retries a 404, and says the route is not deployed", async () => {
    const { send, calls } = stub([json({}, 404)]);
    const answer = await fetchHealth("https://example.test", 3, send);

    expect(calls).toHaveLength(1);
    expect(answer.ok).toBe(false);
    if (answer.ok) throw new Error("unreachable");
    expect(answer.reason).toMatch(/not deployed/);
    expect(answer.reason).toMatch(/Merging is not deploying/);
  });

  it("does not retry a 401 either — a wrong host is not a transient one", async () => {
    const { send, calls } = stub([json({}, 401)]);
    await fetchHealth("https://example.test", 3, send);
    expect(calls).toHaveLength(1);
  });

  it("retries a 503 up to the attempt limit and then gives up", async () => {
    const { send, calls } = stub([json({}, 503)]);
    const answer = await fetchHealth("https://example.test", 3, send);

    expect(calls).toHaveLength(3);
    expect(answer.ok).toBe(false);
  });

  it("retries a thrown fetch, which is DNS or a socket rather than an answer", async () => {
    const { send, calls } = stub([new Error("ECONNREFUSED")]);
    await fetchHealth("https://example.test", 2, send);
    expect(calls).toHaveLength(2);
  });

  it("stops as soon as a retry succeeds", async () => {
    const { send, calls } = stub([json({}, 503), json(payload)]);
    const answer = await fetchHealth("https://example.test", 3, send);

    expect(calls).toHaveLength(2);
    expect(answer.ok).toBe(true);
  });

  /**
   * A typo'd URL answering somebody else's 200 must not produce a confident verdict — which is the
   * failure mode `--host` exists to fix, arriving through the flag itself.
   */
  it("refuses a 200 whose body is not this product's", async () => {
    const { send } = stub([json({ status: "healthy" })]);
    const answer = await fetchHealth("https://example.test", 3, send);

    expect(answer.ok).toBe(false);
    if (answer.ok) throw new Error("unreachable");
    expect(answer.reason).toMatch(/does not recognise/);
  });
});
