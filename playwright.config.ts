import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Read before anything loads `.env.local`, so this is true only when the shell named a database.
 * An already-running dev server was started against whatever database *it* was given; reusing it
 * would seed one database and assert against another, and every spec would fail for the wrong
 * reason. Refusing to reuse turns that into a port-in-use error, which says what is wrong.
 */
const databaseNamedByShell = !!process.env.DATABASE_URL;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/guard.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  /**
   * Zero everywhere, and it was 2 in CI until August 15, 2026.
   *
   * That retry was load-bearing in the worst way: the suite had never been observed green in one
   * pass locally, and CI never had to be, because two retries absorbed a transient `ENOTFOUND`
   * against Neon and reported green. A retry here does not distinguish a network blip from a real
   * regression — it makes them look identical, and the next thing landing is P3, which rewrites
   * every scoped read and whose failure mode is a denial that silently stops denying.
   *
   * The blip itself is fixed where it belongs, in `src/db/connect.ts`. If this goes red on
   * infrastructure anyway, the answer is to widen that — with the argument `neverArrived` demands —
   * and never to put the retry back here, where it hides the thing it retries.
   */
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "list" : "html",
  /**
   * Scoring 8 teams x 3 judges is 96 form fills and 24 server-action round-trips.
   * That is comfortably slower than Playwright's 30s default, and it says nothing about
   * the product's own "under 5 minutes" bar — the test asserts that separately.
   *
   * **Which is why this must sit above five minutes, and did not until August 15, 2026.** It was
   * 180_000, so the harness killed the acceptance test at three minutes and PRD §8.3's own bar —
   * `expect(elapsedMinutes).toBeLessThan(5)` in `scoring.spec.ts` — could never be the thing that
   * failed. Two numbers claimed to be one limit and the stricter one was the accident: a run slow
   * enough to breach the bar the product is sold on died first, reporting a timeout instead. Six
   * minutes leaves the assertion room to fire and say what it means. For scale, the same test runs
   * in about 46 seconds on a quiet laptop.
   */
  timeout: 360_000,
  expect: { timeout: 10_000 },
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    {
      name: "mobile-judge",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        /**
         * **A production build in CI, `next dev` on a laptop, and the difference is not a preference.**
         *
         * `next dev` compiles a route the first time somebody visits it, and it recompiles while the
         * suite is running. A Server Action's id is derived from the build, so a page rendered before
         * a recompile posts an id the server no longer knows, and Next answers:
         *
         *     Failed to find Server Action. This request might be from an older or newer deployment.
         *
         * The form silently does nothing, and the test fails several assertions later on a heading
         * that never appeared — naming a scoring bug that is really a compiler race. It cost three
         * red runs across two PRs before the line was read rather than the failure it produced, and
         * with `retries: 0` (correctly) every occurrence is a red build.
         *
         * `next build` once, then `next start`, removes the whole class: ids are fixed at build time
         * and nothing recompiles mid-suite. It is also closer to what production actually serves,
         * which is this repo's own standing complaint about every other verdict it prints — an
         * instrument pointed at something other than the thing it is describing.
         *
         * The build is part of the command rather than a CI step so that `bun run e2e` means the same
         * thing on a laptop with `CI=1` as it does in Actions, and the timeout carries it.
         */
        command: process.env.CI ? "bun run build && bun run start" : "bun run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI && !databaseNamedByShell,
        timeout: process.env.CI ? 300_000 : 120_000,
      },
});
