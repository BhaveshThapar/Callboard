import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

/**
 * The DB wiring vitest cannot cover: `checkDemoHealth` reads a real seeded comp and confirms a
 * board link resolves. Failure verdicts are covered by the pure tests in src/db/__tests__.
 * The suite's guard already refuses the protected `main` compute, so this runs on dev/ci only.
 */
test("db:doctor passes on a freshly seeded demo", () => {
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts"], { stdio: "pipe" });

  const out = execFileSync("bunx", ["tsx", "src/db/doctor-cli.ts"], { encoding: "utf8" });
  expect(out).toContain("healthy");
});
