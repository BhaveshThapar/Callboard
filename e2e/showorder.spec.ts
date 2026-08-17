import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * G1 — the Friday-night draw, walked.
 *
 * The claim this file exists to hold is the one a unit test cannot: **a reorder is a trade, and the
 * database allows it.** `teams_comp_performance_order_unique` is `DEFERRABLE INITIALLY DEFERRED`
 * because a non-deferred unique refuses the single `UPDATE` that swaps two positions — probed on
 * `dev` before the migration was written, and proven here through the product, over neon-http, which
 * is the only place the deferral actually has to work.
 *
 * Every assertion polls the *positions* rather than the status line. The status line is what a first
 * draft asserted on, and it passed instantly against the message the **previous** click had left on
 * screen — a green test that never waited for the write it was describing.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "draw-e2e-org";
const COMP = "draw-e2e-comp";
const OTHER = "draw-e2e-other";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

/**
 * The last team is `applied` on purpose: it is billed by nobody, ranked by nobody, and must not be
 * in the running order either. `PERFORMING_STATUSES` is what decides that, and it is deliberately
 * its own list rather than an alias of `SCOREABLE_STATUSES`.
 *
 * Teams arrive already numbered `1..N` — `parseCompConfig` defaults `performanceOrder` to `i + 1`,
 * so a seeded comp has a running order before any board touches it. That is worth knowing rather
 * than working around: it is what the demo comp looks like, so it is what the screen must handle.
 */
const compConfig = (slug: string, codes: string[]) => ({
  org: { name: "Draw E2E Org", slug: ORG },
  comp: { name: `Draw E2E ${slug}`, slug, compDate: "2027-03-06", status: "open" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: codes.map((code, i) => ({
    name: `Draw Team ${code}`,
    bidCode: code,
    status: i === codes.length - 1 ? "applied" : "accepted",
    rosterSize: 18,
  })),
  judges: [{ name: "Judge One" }],
  board: [{ name: "Draw Chair" }],
});

const seed = (slug: string, codes: string[]): SeededComp => {
  const config = tmp(`${slug}.json`);
  writeFileSync(config, JSON.stringify(compConfig(slug, codes)));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

const positions = async (page: Page, codes: string[]): Promise<string[]> =>
  Promise.all(
    codes.map(async (code) =>
      ((await page.getByTestId(`show-order-position-${code}`).textContent()) ?? "").trim(),
    ),
  );

const expectOrder = async (page: Page, codes: string[], want: string[]): Promise<void> => {
  await expect.poll(async () => positions(page, codes), { timeout: 15_000 }).toEqual(want);
};

test("the running order shows every team that takes the stage, and no other", async ({ page }) => {
  const { boardToken } = seed(COMP, ["A-1", "A-2", "A-3", "A-4"]);

  await page.goto(`/board/${boardToken}/comp-day`);
  await expect(page.getByTestId("show-order")).toBeVisible();

  await expectOrder(page, ["A-1", "A-2", "A-3"], ["1", "2", "3"]);
  // Applied, so it is in no running order. Not hidden — never placed there at all.
  await expect(page.getByTestId("show-order-row-A-4")).toHaveCount(0);
});

test("moving one act is a trade, which the deferred constraint is what allows", async ({ page }) => {
  const { boardToken } = seed(COMP, ["A-1", "A-2", "A-3", "A-4"]);

  await page.goto(`/board/${boardToken}/comp-day`);
  await expectOrder(page, ["A-1", "A-2", "A-3"], ["1", "2", "3"]);

  // The whole point: one UPDATE holding two teams at position 2 halfway through. A non-deferred
  // unique rejects it with `duplicate key value violates unique constraint`.
  await page.getByTestId("show-order-up-A-3").click();
  await expectOrder(page, ["A-1", "A-2", "A-3"], ["1", "3", "2"]);

  // A trade, not a renumber: moving A-1 exchanges it with whoever is next, and touches nobody else.
  await page.getByTestId("show-order-down-A-1").click();
  await expectOrder(page, ["A-1", "A-2", "A-3"], ["2", "3", "1"]);
});

test("renumbering puts the order back to 1..N without changing who is where", async ({ page }) => {
  const { boardToken } = seed(COMP, ["A-1", "A-2", "A-3", "A-4"]);

  await page.goto(`/board/${boardToken}/comp-day`);
  await page.getByTestId("show-order-up-A-3").click();
  await expectOrder(page, ["A-1", "A-2", "A-3"], ["1", "3", "2"]);

  await page.getByTestId("show-order-draw").click();
  // A-3 stays second and A-2 stays third; renumbering is 1..N over the order as it now reads, not a
  // reset to the order the comp was seeded in.
  await expectOrder(page, ["A-1", "A-2", "A-3"], ["1", "3", "2"]);
});

test("a team at the start of the order cannot be moved past it, and is told so by name", async ({
  page,
}) => {
  const { boardToken } = seed(COMP, ["A-1", "A-2", "A-3", "A-4"]);

  await page.goto(`/board/${boardToken}/comp-day`);
  await expectOrder(page, ["A-1", "A-2", "A-3"], ["1", "2", "3"]);

  await page.getByTestId("show-order-up-A-1").click();
  await expect(page.getByTestId("show-order-message")).toContainText(
    "Draw Team A-1 is already at the start",
  );
  await expectOrder(page, ["A-1", "A-2", "A-3"], ["1", "2", "3"]);
});

test("one comp's draw does not move another comp's", async ({ page }) => {
  const mine = seed(COMP, ["A-1", "A-2", "A-3", "A-4"]);
  const theirs = seed(OTHER, ["B-1", "B-2", "B-3"]);

  await page.goto(`/board/${mine.boardToken}/comp-day`);
  await page.getByTestId("show-order-up-A-3").click();
  await expectOrder(page, ["A-1", "A-2", "A-3"], ["1", "3", "2"]);

  // The other comp is scoped by its own actor, so nothing here reached it. Both comps holding
  // position 1 at once is also the case the constraint must *not* refuse: it is keyed on
  // `(comp_id, performance_order)`, and a per-comp guarantee that fired across comps would make a
  // second division unseedable.
  await page.goto(`/board/${theirs.boardToken}/comp-day`);
  await expectOrder(page, ["B-1", "B-2"], ["1", "2"]);

  await page.goto(`/board/${mine.boardToken}/comp-day`);
  await expectOrder(page, ["A-1", "A-2", "A-3"], ["1", "3", "2"]);
});
