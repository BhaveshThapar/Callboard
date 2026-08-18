import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * G3 — the cell that does not exist in the spreadsheet.
 *
 * PRD §9: *"Saturday, when the show runs behind, there is no cell to type the delay into — a human
 * re-derives the entire cascade across a six-room matrix… then broadcasts it by mouth and GroupMe
 * while every printed and open copy goes silently stale."* This file is that cell, walked: one
 * number goes in, and every derived time moves.
 *
 * The properties worth holding are the ones a unit test cannot: that the derivation a board reads is
 * the one the database supports, that a delay is **append-only** so the record of what was told to
 * whom survives, and that a team which has already danced is not re-timed by a later slip.
 */

type SeededComp = { compId: string; boardToken: string };

const ORG = "gita-e2e-org";
const COMP = "gita-e2e-comp";

const tmp = (name: string): string => join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), name);

const CONFIG = {
  org: { name: "Gita E2E Org", slug: ORG },
  // `live` is the morning of the show, and it is what gates a delay being enterable at all.
  comp: { name: "Gita E2E 2027", slug: COMP, compDate: "2027-03-06", status: "live" },
  rubric: {
    name: "Test rubric",
    normalization: "raw",
    criteria: [{ label: "Choreography", maxPoints: 30 }],
  },
  teams: [
    { name: "Gita Alpha", bidCode: "G-1", status: "accepted", rosterSize: 18 },
    { name: "Gita Beta", bidCode: "G-2", status: "accepted", rosterSize: 18 },
    { name: "Gita Gamma", bidCode: "G-3", status: "accepted", rosterSize: 18 },
  ],
  judges: [{ name: "Judge One" }],
  board: [{ name: "Gita Chair" }],
  schedule: {
    // Doors at noon in Maryland; first act two hours later. The anchor is a wall clock in the
    // comp's own zone, which is the whole reason `timezone` is stated rather than inferred.
    anchor: "2027-03-06T12:00",
    timezone: "America/New_York",
    firstSlotAtMinute: 120,
    slotMinutes: 8,
    changeoverMinutes: 4,
    rooms: [
      { id: "stage", label: "Main stage" },
      { id: "green", label: "Green room" },
    ],
    teamBuffers: [
      { kind: "stretch", durationMinutes: 20, endsBeforePerformance: 30, room: "green" },
      { kind: "walk", durationMinutes: 6, endsBeforePerformance: 0, room: "stage" },
    ],
    compSegments: [
      {
        kind: "food",
        id: "dinner",
        label: "Dinner",
        startsAtMinute: 300,
        durationMinutes: 60,
        movesWithShow: false,
      },
      {
        kind: "judge_cutoff",
        id: "cutoff",
        label: "Judges' cutoff",
        startsAtMinute: 400,
        durationMinutes: 30,
        movesWithShow: true,
      },
    ],
    slack: [{ id: "filler", label: "Filler act", minutes: 8 }],
  },
};

const seed = (): SeededComp => {
  const config = tmp("gita.json");
  writeFileSync(config, JSON.stringify(CONFIG));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  return JSON.parse(readFileSync(out, "utf8")) as SeededComp;
};

/** Every rendered segment line, as flat text, so an assertion can talk about times and names. */
const segments = async (page: Page): Promise<string[]> =>
  (await page.getByTestId("schedule-segment").allInnerTexts()).map((line) =>
    line.replace(/\s+/g, " ").trim(),
  );

const delay = async (
  page: Page,
  fields: { minutes: number; from: number; reason: string },
): Promise<void> => {
  await page.getByTestId("delay-minutes").fill(String(fields.minutes));
  await page.getByTestId("delay-from").fill(String(fields.from));
  await page.getByTestId("delay-reason").fill(fields.reason);
  await page.getByTestId("delay-submit").click();
};

test("the whole cascade derives from the draw, in the comp's own timezone", async ({ page }) => {
  const { boardToken } = seed();

  await page.goto(`/board/${boardToken}/comp-day`);
  await expect(page.getByTestId("schedule")).toBeVisible();
  await expect(page.getByTestId("schedule-delay-total")).toHaveText("On time");

  const lines = await segments(page);
  // Alpha dances at minute 120 = 2:00 PM local. Its walk ends there and lasts six minutes; its
  // stretch ends thirty before and lasts twenty. Rendered in America/New_York, never the server's
  // zone — Vercel runs in UTC, which would print all of these four hours early.
  expect(lines.some((line) => line.includes("1:10 PM") && line.includes("Stretch"))).toBe(true);
  expect(lines.some((line) => line.includes("1:54 PM") && line.includes("Walk"))).toBe(true);
  // A comp-wide fixture belongs to nobody and is on the same timeline.
  expect(lines.some((line) => line.includes("Food"))).toBe(true);
});

test("one number re-times the cascade, and does not re-time an act that already danced", async ({
  page,
}) => {
  const { boardToken } = seed();

  await page.goto(`/board/${boardToken}/comp-day`);
  const before = await segments(page);
  const alphaWalkBefore = before.find((line) => line.includes("Gita Alpha") && line.includes("Walk"));

  // The show slips from act 2 onward. Act 1 has already happened.
  await delay(page, { minutes: 15, from: 2, reason: "stage tech overran" });
  await expect(page.getByTestId("schedule-message")).toContainText("re-timed");
  await expect(page.getByTestId("schedule-delay-total")).toHaveText("Running 15 min behind");

  const after = await segments(page);
  expect(after.find((line) => line.includes("Gita Alpha") && line.includes("Walk"))).toBe(
    alphaWalkBefore,
  );

  // Beta danced at 2:12 PM and now dances at 2:27 PM; its walk ends with it.
  expect(after.some((line) => line.includes("2:21 PM") && line.includes("Gita Beta"))).toBe(true);
});

test("a fixture defined against a clock does not move; one defined against the show does", async ({
  page,
}) => {
  const { boardToken } = seed();

  await page.goto(`/board/${boardToken}/comp-day`);
  const before = await segments(page);
  const dinnerBefore = before.find((line) => line.includes("Food"));
  const cutoffBefore = before.find((line) => line.includes("Judge cutoff"));

  await delay(page, { minutes: 20, from: 1, reason: "ambulance in the loading bay" });
  await expect(page.getByTestId("schedule-message")).toContainText("re-timed");

  const after = await segments(page);
  // Dinner was ordered for a clock time. The caterer did not hear that the show slipped.
  expect(after.find((line) => line.includes("Food"))).toBe(dinnerBefore);
  expect(after.find((line) => line.includes("Judge cutoff"))).not.toBe(cutoffBefore);
});

test("delays compound, and the slack they consume is named before it runs out", async ({ page }) => {
  const { boardToken } = seed();

  await page.goto(`/board/${boardToken}/comp-day`);
  await expect(page.getByTestId("schedule-slack-filler")).toContainText("8 of 8 min left");

  await delay(page, { minutes: 5, from: 1, reason: "late start" });
  await expect(page.getByTestId("schedule-slack-filler")).toContainText("3 of 8 min left");
  await expect(page.getByTestId("schedule-unabsorbed")).toHaveCount(0);

  // Compounding, not replacing: 5 + 12 is 17, which is past the 8 minutes engineered in.
  await delay(page, { minutes: 12, from: 1, reason: "second tech fault" });
  await expect(page.getByTestId("schedule-delay-total")).toHaveText("Running 17 min behind");
  await expect(page.getByTestId("schedule-slack-filler")).toContainText("0 of 8 min left");
  await expect(page.getByTestId("schedule-unabsorbed")).toContainText("9 minutes");

  // Append, never mutate: both statements survive, in the order they were made.
  const record = await page.getByTestId("schedule-delays").innerText();
  expect(record).toContain("late start");
  expect(record).toContain("second tech fault");
});

test("a show that catches up is representable, because a delay is signed", async ({ page }) => {
  const { boardToken } = seed();

  await page.goto(`/board/${boardToken}/comp-day`);
  await delay(page, { minutes: 20, from: 1, reason: "late start" });
  await expect(page.getByTestId("schedule-delay-total")).toHaveText("Running 20 min behind");

  // An act got cut. Recording that as a correction to history is what the append-only chain exists
  // to make impossible, so catching up has to be sayable as its own row.
  await delay(page, { minutes: -12, from: 1, reason: "cut the exhibition set" });
  await expect(page.getByTestId("schedule-delay-total")).toHaveText("Running 8 min behind");
});

test("a comp that has not written its run of show down is told so, not given defaults", async ({
  page,
}) => {
  const config = tmp("bare.json");
  // Everything except the run of show, which is the state every comp is in until a board writes
  // one down -- including the demo comp.
  const bare = { ...CONFIG, schedule: undefined, comp: { ...CONFIG.comp, slug: "gita-e2e-bare" } };
  writeFileSync(config, JSON.stringify(bare));
  const out = tmp("seeded.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--config", config, "--json", out], {
    stdio: "pipe",
  });
  const { boardToken } = JSON.parse(readFileSync(out, "utf8")) as SeededComp;

  await page.goto(`/board/${boardToken}/comp-day`);
  await expect(page.getByTestId("schedule-unconfigured")).toContainText("has not written its run of show down");
  await expect(page.getByTestId("schedule-timeline")).toHaveCount(0);
});
