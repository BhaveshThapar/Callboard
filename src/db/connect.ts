import { neverArrived } from "./errors";

/**
 * Three attempts, not more. A DNS blip resolves in milliseconds or it is an outage, and an outage
 * should reach a person rather than be absorbed for a minute by every page in the product.
 */
const ATTEMPTS = 3;

/** 100ms then 200ms. The whole worst case is 300ms, which a page render can absorb without notice. */
const backoff = (attempt: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, attempt * 100));

/**
 * The `fetch` `neon()` uses, with one behaviour added: a statement that provably never arrived is
 * sent again.
 *
 * neon-http opens a fresh HTTPS request per statement, so every query in this product resolves a
 * hostname. Over a full e2e run that is thousands of resolutions, and on August 15, 2026 one of them
 * failed — `getaddrinfo ENOTFOUND api.us-west-2.aws.neon.tech` — which surfaced as
 * `/board/[token]` answering **500**. The suite had never been green in one pass, and the failing
 * spec moved between runs because the blip lands wherever it lands: `scoring`, then `revoke-board`,
 * then `two-divisions`, each passing when run alone. `retries: 2` in CI was absorbing it, which is
 * why nobody had to look.
 *
 * **This is a product fix wearing a test fix's clothes.** A board loading the roster on a bad DNS
 * moment got the same 500, and the only reason it read as a test problem is that the tests are the
 * only thing exercising the product thousands of times an hour.
 *
 * What it must never become is a general retry. `neverArrived` is the whole safety argument and it
 * is deliberately narrow: a reset connection is not in it, because an `insert` may have committed
 * before the response was lost, and this repo refuses ambiguous retries everywhere money is
 * involved. Widening that set is a decision about correctness, not about flakiness.
 *
 * `send` is injectable so the retry rule is proved by **counting calls** rather than by timing a
 * subprocess — `fetchHealth`'s reason, which is that a wall-clock assertion is a proxy that fails on
 * a loaded machine, and a loaded machine is the one condition under which nobody trusts a red test.
 */
export const retryingFetch =
  (send: typeof fetch = fetch, attempts: number = ATTEMPTS): typeof fetch =>
  async (input, init) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await send(input, init);
      } catch (error) {
        if (attempt >= attempts || !neverArrived(error)) throw error;
        await backoff(attempt);
      }
    }
  };
