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
  retries: process.env.CI ? 2 : 0,
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
        command: "bun run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI && !databaseNamedByShell,
        timeout: 120_000,
      },
});
