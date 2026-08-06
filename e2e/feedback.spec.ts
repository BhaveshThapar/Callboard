import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * PRD B8: "a clean placement result the emcee can read from directly, plus per-team feedback
 * export." Neither existed. A judge had nowhere to write feedback and the board had nothing to
 * export, so the emcee read placements off a laptop screen.
 */

type SeededDemo = {
  compId: string;
  compName: string;
  boardName: string;
  boardToken: string;
  judges: { name: string; token: string }[];
};

const CRITERIA = [
  { label: "Choreography", maxPoints: 30 },
  { label: "Execution", maxPoints: 30 },
  { label: "Musicality", maxPoints: 20 },
  { label: "Stage Presence", maxPoints: 20 },
];

const TEAM_COUNT = 8;
const NOTE = 'Tight formations, but the third transition drags. Judge said "watch it".';

const comms = (...args: string[]): string =>
  execFileSync("bunx", ["tsx", "e2e/support/comms.ts", ...args], { encoding: "utf8" }).trim();

const seed = (): SeededDemo => {
  const file = join(mkdtempSync(join(tmpdir(), "callboard-e2e-")), "demo.json");
  execFileSync("bunx", ["tsx", "src/db/seed-cli.ts", "--json", file], { stdio: "pipe" });
  return JSON.parse(readFileSync(file, "utf8")) as SeededDemo;
};

test("a judge's note reaches the feedback export, and the emcee gets a printable sheet", async ({
  browser,
}) => {
  const demo = seed();
  const judge = demo.judges[0]!;

  const judgeContext = await browser.newContext();
  const judgePage = await judgeContext.newPage();
  await judgePage.goto(`/judge/${judge.token}`);

  // The note lives in its own form, so it cannot be nested inside the score form.
  const cards = judgePage.locator('form[data-testid^="team-card-"]');
  await expect(cards).toHaveCount(TEAM_COUNT);
  await expect(judgePage.locator('form[data-testid^="team-note-"]')).toHaveCount(TEAM_COUNT);

  for (let teamIndex = 0; teamIndex < TEAM_COUNT; teamIndex++) {
    const card = cards.nth(teamIndex);
    for (const criterion of CRITERIA) {
      await card
        .getByLabel(criterion.label, { exact: true })
        .fill(String(Math.max(0, criterion.maxPoints - teamIndex)));
    }
    await card.getByRole("button", { name: /Submit|Update/ }).click();
    await expect(card.getByText("Scored")).toBeVisible();
  }

  // Feedback on the leading team only. The comma and the quotes are the CSV escaping test.
  const noteForm = judgePage.locator('form[data-testid="team-note-A-114"]');
  await noteForm.getByLabel("Notes").fill(NOTE);
  await noteForm.getByRole("button", { name: "Save note" }).click();
  await expect(noteForm.getByText("Note saved")).toBeVisible();

  // A note survives a reload, so it is stored rather than merely displayed.
  await judgePage.reload();
  await expect(judgePage.locator('form[data-testid="team-note-A-114"]').getByLabel("Notes")).toHaveValue(
    NOTE,
  );
  await judgeContext.close();

  const board = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const boardPage = await board.newPage();

  // Before the lock there is nothing to export: the snapshot the export reads does not exist.
  const early = await boardPage.goto(`/board/${demo.boardToken}/feedback?team=A-114`);
  expect(early?.status()).toBe(409);
  // 200 with an empty state rather than a 404 since ADR-0022: the shell now *links* Results, and a
  // nav item that 404s is the defect this repo has been bitten by twice. The page still shows no
  // placements, which is the assertion that matters — there are none to show.
  const earlyResults = await boardPage.goto(`/board/${demo.boardToken}/results`);
  expect(earlyResults?.status()).toBe(200);
  await expect(boardPage.getByTestId("results-not-locked")).toBeVisible();

  await boardPage.goto(`/board/${demo.boardToken}`);
  await boardPage.getByTestId("lock-button").click();
  await expect(boardPage.getByRole("heading", { name: "Final placements" })).toBeVisible();

  // The emcee sheet reads from the frozen snapshot, and names the teams.
  await boardPage.getByTestId("emcee-link").click();
  await expect(boardPage.getByRole("heading", { name: "Final placements" })).toBeVisible();
  await expect(boardPage.locator("ol li").first()).toContainText("NCSU Nazaare");
  await expect(boardPage.locator("ol li")).toHaveCount(TEAM_COUNT);
  await expect(boardPage.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();

  // The sheet the emcee reads from checks reproduction itself, and only then claims it.
  await expect(boardPage.getByTestId("reproduction-failure")).toHaveCount(0);
  await expect(boardPage.getByText("Reproduced from the locked snapshot.")).toBeVisible();

  // Feedback is per team, and only per team: there is no whole-comp file to forward by accident.
  await expect(boardPage.getByTestId("feedback-link-A-114")).toBeVisible();
  const unfiltered = await boardPage.request.get(`/board/${demo.boardToken}/feedback`);
  expect(unfiltered.status()).toBe(400);

  // The team's file carries the note, escapes it, and names no judge.
  const response = await boardPage.request.get(`/board/${demo.boardToken}/feedback?team=A-114`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  expect(response.headers()["content-disposition"]).toContain("attachment");

  const csv = await response.text();
  expect(csv.split("\r\n")[0]).toBe(
    "Place,Team,Bid code,Team deduction,Deduction reason,Judge,Note",
  );
  expect(csv).toContain("NCSU Nazaare");
  expect(csv).toContain("Judge 1");
  // The comma inside the note must not have split the row, and the quotes must be doubled.
  expect(csv).toContain(
    '"Tight formations, but the third transition drags. Judge said ""watch it""."',
  );

  // This team's rows and no other team's. Only one judge scored, so A-114 has exactly one row --
  // the other two judges neither scored it nor wrote to it, and a blank row would say nothing.
  const teamRows = csv.split("\r\n").slice(1);
  expect(teamRows).toHaveLength(1);
  expect(teamRows[0]).toContain("A-114");

  // The two things a team must never receive: a judge's name, and a number.
  for (const j of demo.judges) expect(csv).not.toContain(j.name);
  for (const criterion of CRITERIA) expect(csv).not.toContain(criterion.label);
  // A-114 led, so it was scored exactly maxPoints on each criterion. None of those may appear.
  for (const criterion of CRITERIA) expect(csv).not.toContain(String(criterion.maxPoints));

  // The board's own breakdown does carry the numbers -- under a label, never under a name.
  const audit = await boardPage.request.get(`/board/${demo.boardToken}/scores`);
  expect(audit.status()).toBe(200);
  const auditCsv = await audit.text();
  expect(auditCsv.split("\r\n")[0]).toBe(
    "Place,Team,Bid code,Judge,Choreography,Execution,Musicality,Stage Presence,Judge total,Team deduction",
  );
  expect(auditCsv).toContain("Judge 1");
  expect(auditCsv).toContain(`,${CRITERIA[0]!.maxPoints},`);
  expect(auditCsv.split("\r\n")).toHaveLength(TEAM_COUNT + 1);
  for (const j of demo.judges) expect(auditCsv).not.toContain(j.name);

  /**
   * ADJ·2 — the same projection, delivered rather than downloaded. The map carried this as B8's
   * unbuilt half: the artifact existed and a board's only instrument for handing it over was one
   * download per team, attached by hand, which is both the manual work the record replaces and how
   * a team ends up sent a rival's notes.
   *
   * All eight placed, though only one was scored: a team with no scores still takes a place rather
   * than vanishing, and every placed team is therefore owed the notes written about it — which for
   * seven of them is the honest answer that nobody wrote anything.
   */
  await boardPage.goto(`/board/${demo.boardToken}/results`);
  await boardPage.getByTestId("send-feedback-submit").click();

  const delivery = boardPage.getByTestId("send-feedback-message");
  await expect(delivery).toContainText(`Feedback sent to ${TEAM_COUNT} teams`);
  await expect(delivery).toContainText("No scores are included");

  // A second click reaches nobody twice: the key is the team *and* this run.
  await boardPage.getByTestId("send-feedback-submit").click();
  await expect(delivery).toContainText("already had it for this result");

  const delivered = comms("outbox", "mayuri-2027")
    .split("\n")
    .filter((line) => line.startsWith("feedback.delivered"));
  expect(delivered).toHaveLength(TEAM_COUNT);

  await board.close();
});
