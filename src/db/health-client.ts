import { parseHealthPayload } from "./health";
import type { HealthPayload } from "./health";

export type HealthFetch = { ok: true; payload: HealthPayload } | { ok: false; reason: string };

/** Transient enough to be worth another go. A 404 is not here on purpose — see below. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask a deployment what it has applied and what it is configured to do.
 *
 * **Imports nothing from `@/db`**, which is load-bearing rather than tidy: `db:migration-check` runs
 * in CI where there is deliberately no database credential at all, and `./index` throws at module
 * load when `DATABASE_URL` is unset.
 *
 * A **404 is never retried.** It means the route is not deployed — which during the first rollout of
 * `/api/health` is exactly the state to fail loudly on, because retrying it would spend twenty
 * seconds arriving at the same answer while reading like a flake. Merging is not deploying, and this
 * is the one place that distinction shows up as an HTTP status.
 */
export const fetchHealth = async (host: string, attempts = 3): Promise<HealthFetch> => {
  const url = `${host.replace(/\/+$/, "")}/api/health`;

  let last = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });

      if (response.ok) {
        const payload = parseHealthPayload(await response.json());
        return payload
          ? { ok: true, payload }
          : {
              ok: false,
              reason: `${url} answered 200 with a body this does not recognise. That is usually a URL pointing at something other than this product.`,
            };
      }

      last = `${url} answered ${response.status}`;
      if (!RETRYABLE.has(response.status)) {
        return {
          ok: false,
          reason:
            response.status === 404
              ? `${url} answered 404 — the health route is not deployed on that host. Merging is not deploying; check the Vercel deployment landed.`
              : last,
        };
      }
    } catch (error) {
      last = `${url} could not be reached: ${error instanceof Error ? error.message : String(error)}`;
    }

    if (attempt < attempts) await delay(attempt * 1000);
  }

  return { ok: false, reason: `${last} after ${attempts} attempts.` };
};
