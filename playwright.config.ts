import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : "html",
  /**
   * Scoring 8 teams x 3 judges is 96 form fills and 24 server-action round-trips.
   * That is comfortably slower than Playwright's 30s default, and it says nothing about
   * the product's own "under 5 minutes" bar — the test asserts that separately.
   */
  timeout: 180_000,
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
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
