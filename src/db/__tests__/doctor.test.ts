import { describe, expect, it } from "vitest";
import type { ConfigObserved, Observed } from "../health";
import { compareMigrations, parseHealthPayload, summarizeConfig, summarizeHealth } from "../health";

/**
 * A host with everything set. Not the common case in this repo — production deliberately has none of
 * it — but it is the one that must produce silence, so the other fixtures read as departures.
 */
const configured: ConfigObserved = {
  sending: "on",
  sendingMissing: [],
  cron: true,
  baseUrl: true,
  drive: "on",
  driveMissing: [],
  sealing: "on",
  sealingKeyBytes: null,
  source: "this shell",
};

/** Production and every laptop, today. */
const unconfigured: ConfigObserved = {
  sending: "off",
  sendingMissing: ["RESEND_API_KEY", "COMMS_FROM"],
  cron: false,
  baseUrl: false,
  drive: "off",
  driveMissing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NEXT_PUBLIC_BASE_URL"],
  sealing: "off",
  sealingKeyBytes: null,
  source: "this shell",
};

const healthy: Observed = {
  config: configured,
  migrationsApplied: 12,
  migrationsExpected: 12,
  compFound: true,
  boardAssignments: 1,
  boardName: "Ananya Krishnan",
  boardViewLoaded: true,
  judges: 3,
  judgeViewLoaded: true,
  judgeLabels: 3,
  teams: 8,
  forkGuaranteeEnforced: true,
  forkedComps: [],
  moneyGuaranteeEnforced: true,
  driftingPayments: [],
  orphanedAllocations: [],
  forkedDeposits: [],
  unexplainedRefunds: [],
  accountGuaranteeEnforced: true,
  coordGuaranteeEnforced: true,
  scheduleGuaranteeEnforced: true,
  duplicateInvitations: [],
  commsGuaranteeEnforced: true,
  driftingMessages: [],
  stuckMessages: [],
};

const unseeded: Observed = {
  config: configured,
  migrationsApplied: 12,
  migrationsExpected: 12,
  compFound: false,
  boardAssignments: 0,
  boardName: null,
  boardViewLoaded: false,
  judges: 0,
  judgeViewLoaded: false,
  judgeLabels: 0,
  teams: 0,
  forkGuaranteeEnforced: true,
  forkedComps: [],
  moneyGuaranteeEnforced: true,
  driftingPayments: [],
  orphanedAllocations: [],
  forkedDeposits: [],
  unexplainedRefunds: [],
  accountGuaranteeEnforced: true,
  coordGuaranteeEnforced: true,
  scheduleGuaranteeEnforced: true,
  duplicateInvitations: [],
  commsGuaranteeEnforced: true,
  driftingMessages: [],
  stuckMessages: [],
};

const expected = { judges: 3, teams: 8 };

describe("summarizeHealth", () => {
  it("passes a fully seeded demo", () => {
    const health = summarizeHealth(healthy, expected);
    expect(health).toEqual({
      ok: true,
      board: "Ananya Krishnan",
      judges: 3,
      teams: 8,
      config: { caveats: [], hazards: [], source: "this shell" },
    });
  });

  it("fails when no live board link resolves (the dropped-column footgun)", () => {
    const health = summarizeHealth(
      { ...healthy, boardAssignments: 0, boardName: null, boardViewLoaded: false },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems).toHaveLength(1);
    expect(health.problems[0]).toMatch(/no board link/);
    expect(health.problems[0]).toMatch(/reseed/);
  });

  it("fails when the board view will not render", () => {
    const health = summarizeHealth({ ...healthy, boardViewLoaded: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/board view failed to load/);
  });

  it("fails when a judge link is missing", () => {
    const health = summarizeHealth({ ...healthy, judges: 2 }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/2 of 3 judges/);
  });

  it("fails when the judge view will not render (a judge_notes drift)", () => {
    const health = summarizeHealth({ ...healthy, judgeViewLoaded: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/judge view failed to load/);
    expect(health.problems[0]).toMatch(/reseed/);
  });

  it("fails when a judge has no de-identified label (the board export would name them)", () => {
    const health = summarizeHealth({ ...healthy, judgeLabels: 0 }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/0 of 3 judges have a Judge N label/);
  });

  it("reports the comp as unseeded before any other problem", () => {
    const health = summarizeHealth(unseeded, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems).toEqual(["comp not seeded — run 'bun run db:seed'"]);
  });

  it("fails when the chain indexes are missing — the demo can still fork its results", () => {
    const health = summarizeHealth({ ...healthy, forkGuaranteeEnforced: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/can still fork/);
    expect(health.problems[0]).toMatch(/0006/);
    expect(health.problems[0]).toMatch(/db:migrate/);
    // Reseeding does not create an index. Offering it is the demo lying about its own repair.
    expect(health.problems[0]).not.toMatch(/db:seed/);
  });

  it("fails when a comp has already forked, and does not offer to reseed it", () => {
    const health = summarizeHealth(
      { ...healthy, forkGuaranteeEnforced: false, forkedComps: [{ compId: "abc-123", roots: 2 }] },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const fork = health.problems.find((p) => p.includes("abc-123"));
    expect(fork).toMatch(/2 locked-result chains, not one/);
    expect(fork).toMatch(/human must decide/);
    expect(fork).not.toMatch(/db:seed/);
  });

  // The whole point of the check. A database missing the indexes is missing them whether or not
  // anyone has seeded a demo onto it -- and `db:seed`, the only thing the unseeded branch suggests,
  // will not add them. Swallowing this behind the short-circuit is how it stays invisible.
  it("reports a missing chain index even when the comp is not seeded", () => {
    const health = summarizeHealth({ ...unseeded, forkGuaranteeEnforced: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems).toHaveLength(2);
    expect(health.problems[0]).toMatch(/can still fork/);
    expect(health.problems[1]).toMatch(/comp not seeded/);
  });

  // A comp that has never been locked has no runs at all, so it groups to nothing and is not a fork.
  // If this ever fails, every pre-lock demo on earth is being called broken.
  it("passes a healthy database whose comp has never been locked", () => {
    const health = summarizeHealth({ ...healthy, forkedComps: [] }, expected);
    expect(health.ok).toBe(true);
  });

  /**
   * It used to say *"this database predates migration 0009"*, and that was false as soon as
   * `MONEY_CONSTRAINTS` grew past `0009`: `deposit_events_terminal_unique` ships in `0010` and
   * `payments_refunded_check` in `0011`, so a database missing either was told to apply a migration
   * it already had. The verdict was right and the sentence was wrong, which is the failure mode
   * `db:doctor` exists to not have — so it names no migration, and `schemaProblems` reports the
   * distance from the journal, which is the number that was always true.
   */
  it("reports missing money constraints without naming a migration it cannot know", () => {
    const health = summarizeHealth({ ...healthy, moneyGuaranteeEnforced: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const money = health.problems.find((p) => p.includes("allocated past"));
    expect(money).toMatch(/db:migrate/);
    expect(money).not.toMatch(/00\d\d/);
    // Reseeding does not create a constraint, so it must not be offered as the remedy.
    expect(money).not.toMatch(/db:seed/);
  });

  /**
   * The credential half of the same family. Nothing in the product produces two live invitations --
   * `invite` revokes the previous envelope first -- so a duplicate means the index is gone or
   * something wrote around the product, and either way a person has two valid ways into one comp.
   */
  it("reports a person holding two live invitations, and does not offer to reseed", () => {
    const health = summarizeHealth(
      { ...healthy, duplicateInvitations: [{ personId: "person-7", live: 2 }] },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const duplicate = health.problems.find((p) => p.includes("person-7"));
    expect(duplicate).toMatch(/2 live invitations/);
    expect(duplicate).toMatch(/an invitation is spent once/);
    expect(duplicate).toMatch(/human must decide/);
    expect(duplicate).not.toMatch(/db:seed/);
  });

  /**
   * The one state the doctor reports on that the product cannot take back. A send that succeeded and
   * then crashed before recording it leaves exactly this, and retrying emails somebody twice -- so
   * the sentence has to send a human to check rather than promise a machine will handle it.
   */
  it("reports a message stuck mid-send, and does not promise a retry", () => {
    const health = summarizeHealth(
      { ...healthy, stuckMessages: [{ messageId: "msg-2", minutes: 90 }] },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const stuck = health.problems.find((p) => p.includes("msg-2"));
    expect(stuck).toMatch(/90 minutes/);
    expect(stuck).toMatch(/not retried automatically/);
    expect(stuck).toMatch(/whether it arrived/);
    expect(stuck).not.toMatch(/db:seed/);
  });

  // ADR-0014's residual, twice over: a cache the database cannot make agree with its record.
  it("reports a message whose cached state disagrees with its own chain", () => {
    const health = summarizeHealth(
      { ...healthy, driftingMessages: [{ messageId: "msg-9", state: "queued", head: "sent" }] },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const drift = health.problems.find((p) => p.includes("msg-9"));
    expect(drift).toMatch(/cached as queued/);
    expect(drift).toMatch(/ends at sent/);
    expect(drift).toMatch(/chain is the record/);
  });

  it("reports missing account constraints without naming a migration", () => {
    const health = summarizeHealth({ ...healthy, accountGuaranteeEnforced: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const accounts = health.problems.find((p) => p.includes("two live invitations to one comp"));
    expect(accounts).toMatch(/db:migrate/);
    expect(accounts).not.toMatch(/db:seed/);
  });

  // `forkedComps`' sentence about a smaller question. Unrepresentable since `0011` rekeyed the
  // terminal index to `(comp_id, team_id)`, which is exactly why the doctor still looks.
  it("reports a deposit that ended twice, and does not offer to reseed it away", () => {
    const health = summarizeHealth(
      { ...healthy, forkedDeposits: [{ teamId: "team-4", endings: 2 }] },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const forked = health.problems.find((p) => p.includes("team-4"));
    expect(forked).toMatch(/2 deposit endings/);
    expect(forked).toMatch(/a deposit ends once/);
    expect(forked).toMatch(/human must decide/);
    expect(forked).not.toMatch(/db:seed/);
  });

  // The residual ADR-0015 accepted, and it is `allocated_cents`' twice over: a CHECK constrains
  // `refunded_cents` against the payment's own gross, and nothing can make it agree with the deposit
  // chain, because that agreement spans tables.
  it("reports money marked refunded with no ending to account for it", () => {
    const health = summarizeHealth(
      { ...healthy, unexplainedRefunds: [{ paymentId: "pay-3", refundedCents: 10000 }] },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const orphan = health.problems.find((p) => p.includes("pay-3"));
    expect(orphan).toMatch(/10000 cents refunded/);
    expect(orphan).toMatch(/never returned/);
    expect(orphan).not.toMatch(/db:seed/);
  });

  // ADR-0014's named residual: the CHECK constrains the counter, not the sum it stands for. This is
  // the half that can only be found, and finding it is the reason the trade was acceptable at all.
  it("reports a payment whose counter drifted from its live allocations, by id", () => {
    const health = summarizeHealth(
      {
        ...healthy,
        driftingPayments: [{ paymentId: "pay-9", allocatedCents: 216000, allocatedSum: 0 }],
      },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const drift = health.problems.find((p) => p.includes("pay-9"));
    expect(drift).toMatch(/216000 cents are allocated/);
    expect(drift).toMatch(/sum to 0/);
    expect(drift).toMatch(/human must decide/);
    expect(drift).not.toMatch(/db:seed/);
  });

  /**
   * The second bad state of the same family, and the one the drift check structurally cannot see:
   * the counter and the live allocations agree perfectly, and what has gone is the charge
   * underneath — which that comparison never joins to. Voiding a charge now releases its
   * allocations, so a row here predates that, which is exactly why the doctor looks.
   */
  it("reports an allocation still pointing at a voided charge, naming both ids", () => {
    const health = summarizeHealth(
      {
        ...healthy,
        orphanedAllocations: [{ paymentId: "pay-4", chargeId: "chg-7", amountCents: 112000 }],
      },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const orphan = health.problems.find((p) => p.includes("pay-4"));
    expect(orphan).toMatch(/chg-7/);
    expect(orphan).toMatch(/112000 cents/);
    expect(orphan).toMatch(/has been voided/);
    expect(orphan).toMatch(/human must release it/);
    // Reseeding does not repair a row a human has to decide about.
    expect(orphan).not.toMatch(/db:seed/);
  });

  it("says nothing about orphaned allocations when there are none", () => {
    const health = summarizeHealth(healthy, expected);
    expect(health.ok).toBe(true);
  });

  // Same argument as the chain indexes: a database without the money constraints is missing them
  // whether or not a demo has been seeded onto it, and `db:seed` will not add them.
  it("reports missing money constraints even when the comp is not seeded", () => {
    const health = summarizeHealth({ ...unseeded, moneyGuaranteeEnforced: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems).toHaveLength(2);
    expect(health.problems[0]).toMatch(/allocated past/);
    expect(health.problems[1]).toMatch(/comp not seeded/);
  });

  it("does not confuse a chain problem with a money problem", () => {
    const health = summarizeHealth(
      { ...healthy, forkGuaranteeEnforced: false, moneyGuaranteeEnforced: false },
      expected,
    );
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems).toHaveLength(2);
    expect(health.problems[0]).toMatch(/can still fork/);
    expect(health.problems[1]).toMatch(/allocated past/);
  });
});

/**
 * The backstop for the migration nobody wrote a check for. `0007` adds a nullable column, breaks no
 * guarantee any other check names, and took the deployed demo down for nineteen days in July 2026
 * while every other check here passed.
 */
describe("summarizeHealth migration lag", () => {
  /**
   * Lags are expressed relative to the journal rather than written down, for the reason
   * `migrationsExpected` reads the journal instead of carrying a number: a literal here is a second
   * definition of how many migrations exist, and it is wrong the next time somebody generates one.
   * These assertions were `/4 migrations behind/` until `0011` made them `/5/`.
   */
  const behindBy = (n: number) => ({ ...healthy, migrationsApplied: healthy.migrationsExpected - n });

  it("fails a database behind the repo, and names how far", () => {
    const health = summarizeHealth(behindBy(4), expected);

    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/4 migrations behind/);
    expect(health.problems[0]).toMatch(
      new RegExp(`${healthy.migrationsExpected - 4} applied, ${healthy.migrationsExpected} in drizzle`),
    );
    expect(health.problems[0]).toMatch(/db:migrate/);
  });

  it("says migration, singular, when it is one behind", () => {
    const health = summarizeHealth(behindBy(1), expected);

    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/1 migration behind/);
  });

  /** Reseeding does not apply a migration, so it must not be offered as the remedy. */
  it("never offers a reseed for a schema that is behind", () => {
    const health = summarizeHealth(behindBy(4), expected);

    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).not.toMatch(/db:seed/);
  });

  /**
   * The outage was found on a database whose demo comp was still seeded and still resolving links.
   * A schema this far behind has to be reported even when there is no comp to report it about --
   * and especially then, because `db:seed` runs this check and would otherwise seed onto it.
   */
  it("reports a behind schema even when the comp is not seeded", () => {
    const health = summarizeHealth(
      { ...unseeded, migrationsApplied: unseeded.migrationsExpected - 5 },
      expected,
    );

    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems[0]).toMatch(/5 migrations behind/);
    expect(health.problems.at(-1)).toMatch(/comp not seeded/);
  });

  it("passes a database level with the repo", () => {
    expect(summarizeHealth(healthy, expected).ok).toBe(true);
  });

  /**
   * Ahead is not behind. A branch whose migration was reverted in the repo is a situation a
   * preflight has no remedy for, and inventing one would be noise before a call.
   */
  it("passes a database ahead of the repo rather than inventing a problem", () => {
    expect(summarizeHealth({ ...healthy, migrationsApplied: 12 }, expected).ok).toBe(true);
  });

  /** Skipped, not guessed: a database with no `drizzle` schema cannot be compared. */
  it("says nothing when the migration table is absent", () => {
    expect(summarizeHealth({ ...healthy, migrationsApplied: null }, expected).ok).toBe(true);
  });
});

/**
 * C1. The pair of partial unique indexes is what makes "one live duty per person" a property of the
 * database rather than of the code — a comp running against a database that has the code and not the
 * indexes lets a double-clicked assign button write the duty twice, and nothing else would notice.
 */
/**
 * G1. A duplicate slot is not a cosmetic clash: every walk, stretch and tech call is derived off a
 * team's position, so two teams sharing one hands them the same stage time and hands the liaison
 * walking each of them the same instruction.
 */
describe("summarizeHealth — the running-order guarantee", () => {
  it("reports a database where two teams could hold the same slot", () => {
    const health = summarizeHealth({ ...healthy, scheduleGuaranteeEnforced: false }, expected);
    expect(health.ok).toBe(false);
    if (!health.ok) {
      expect(health.problems.join(" ")).toMatch(/same slot in the running order/);
      expect(health.problems.join(" ")).toMatch(/db:migrate/);
      // Reseeding does not create a constraint. Offering it is the demo lying about its own repair.
      expect(health.problems.join(" ")).not.toMatch(/db:seed/);
    }
  });

  it("reports it even when the comp is not seeded, because seeding does not add it", () => {
    const health = summarizeHealth({ ...unseeded, scheduleGuaranteeEnforced: false }, expected);
    expect(health.ok).toBe(false);
    if (!health.ok) expect(health.problems.join(" ")).toMatch(/same slot in the running order/);
  });

  it("says nothing when the constraint is there", () => {
    expect(summarizeHealth(healthy, expected).ok).toBe(true);
  });
});

describe("summarizeHealth — the coordination guarantee", () => {
  it("reports a database whose assignments indexes are missing, and names the remedy", () => {
    const health = summarizeHealth({ ...healthy, coordGuaranteeEnforced: false }, expected);
    expect(health.ok).toBe(false);
    if (!health.ok) {
      expect(health.problems.join(" ")).toMatch(/same duty twice/);
      expect(health.problems.join(" ")).toMatch(/db:migrate/);
    }
  });

  it("says nothing when the indexes are there", () => {
    const health = summarizeHealth(healthy, expected);
    expect(health.ok).toBe(true);
  });
});

/**
 * The comparison the CI guard shares with the preflight, and the reason it is a shared *sentence*
 * rather than a shared policy: `unknown` is skipped here and fatal there.
 */
describe("compareMigrations", () => {
  it("is level when the counts match", () => {
    expect(compareMigrations(15, 15)).toEqual({ state: "level", applied: 15, expected: 15 });
  });

  it("is ahead when production has more than the checkout, which is not a fault", () => {
    expect(compareMigrations(16, 15)).toEqual({ state: "ahead", applied: 16, expected: 15 });
  });

  it("is behind, and says by how many and what to run", () => {
    const comparison = compareMigrations(10, 15);
    expect(comparison.state).toBe("behind");
    if (comparison.state !== "behind") throw new Error("unreachable");
    expect(comparison.behind).toBe(5);
    expect(comparison.sentence).toMatch(/5 migrations behind/);
    expect(comparison.sentence).toMatch(/db:migrate/);
  });

  it("says 'migration' rather than 'migrations' for one", () => {
    const comparison = compareMigrations(14, 15);
    if (comparison.state !== "behind") throw new Error("unreachable");
    expect(comparison.sentence).toMatch(/1 migration behind/);
  });

  it("is unknown when the drizzle schema is absent, and does not call that behind", () => {
    const comparison = compareMigrations(null, 15);
    expect(comparison.state).toBe("unknown");
    if (comparison.state !== "unknown") throw new Error("unreachable");
    expect(comparison.sentence).not.toMatch(/behind/);
  });

  /**
   * Zero applied is the most behind a database can be, and must never read as "cannot tell" — that
   * distinction is why `observeSchemaVersion` uses `?? null` rather than `|| null`.
   */
  it("treats zero applied as behind, not as unknown", () => {
    expect(compareMigrations(0, 15).state).toBe("behind");
  });
});

describe("summarizeConfig", () => {
  /**
   * **The load-bearing one.** Production has no comms configuration on purpose, three files say so
   * on purpose, and A10/ADJ·2/C2 read `Designed` because of it. A preflight that went red for that
   * state is one the founder learns to ignore before a prospect call, which costs more than the
   * check is worth. This is also what keeps CI green: `ci.yml`'s acceptance job sets no Resend vars.
   */
  it("calls a wholly unconfigured host a caveat, never a hazard", () => {
    const verdict = summarizeConfig(unconfigured);
    expect(verdict.hazards).toEqual([]);
    expect(verdict.caveats.length).toBeGreaterThan(0);
  });

  it("says what an absence costs rather than naming a variable and stopping", () => {
    const verdict = summarizeConfig(unconfigured);
    expect(verdict.caveats.join(" ")).toMatch(/leaves the building/);
    expect(verdict.caveats.join(" ")).toMatch(/never swept/);
  });

  /** Neither is the remedy for a mail key, and offering one sends somebody down an hour of nothing. */
  it("does not offer a reseed or a migration as the fix for configuration", () => {
    const verdict = summarizeConfig(unconfigured);
    expect(verdict.caveats.join(" ")).not.toMatch(/db:seed/);
    expect(verdict.caveats.join(" ")).not.toMatch(/db:migrate/);
  });

  it("states the order to switch comms on in, before anything is switched on", () => {
    const verdict = summarizeConfig(unconfigured);
    const order = verdict.caveats.find((c) => c.includes("CRON_SECRET last"));
    expect(order).toBeDefined();
    // Carries its own reason. An ordering rule with no consequence attached is one somebody
    // reorders when it is inconvenient, which is exactly the afternoon this is written to prevent.
    expect(order).toMatch(/RESEND_API_KEY and COMMS_FROM first/);
    expect(order).toMatch(/refuses to queue any of them again/);
  });

  it("stops repeating the order once cron is already set, because the hazard supersedes it", () => {
    const verdict = summarizeConfig({ ...unconfigured, cron: true });
    expect(verdict.caveats.filter((c) => c.includes("CRON_SECRET last"))).toEqual([]);
  });

  it("says nothing at all about a fully configured host", () => {
    expect(summarizeConfig(configured)).toEqual({
      caveats: [],
      hazards: [],
      source: "this shell",
    });
  });

  /**
   * The destructive combination. Everything else here describes something not working; this
   * describes something working exactly as built, in an order that cannot be undone — the sweep
   * marks the queue sent, `scrubPayload` destroys the invitation links, and the dedupe index then
   * refuses to queue any of it again.
   */
  it("names the one combination that destroys mail, and what it destroys", () => {
    const verdict = summarizeConfig({ ...unconfigured, cron: true });
    const hazard = verdict.hazards.join(" ");
    expect(verdict.hazards.length).toBeGreaterThan(0);
    expect(hazard).toMatch(/marked sent|mark it sent/);
    expect(hazard).toMatch(/nobody/);
    expect(hazard).toMatch(/RESEND_API_KEY/);
    expect(hazard).toMatch(/COMMS_FROM/);
  });

  it("tells somebody to unset CRON_SECRET rather than to press on", () => {
    const verdict = summarizeConfig({ ...unconfigured, cron: true });
    expect(verdict.hazards.join(" ")).toMatch(/Unset CRON_SECRET/);
  });

  it("treats a half-configured pair as a hazard and names the missing half", () => {
    const verdict = summarizeConfig({
      ...unconfigured,
      sending: "partial",
      sendingMissing: ["COMMS_FROM"],
    });
    expect(verdict.hazards.join(" ")).toMatch(/COMMS_FROM is unset/);
    expect(verdict.hazards.join(" ")).toMatch(/half-configured/);
  });

  /**
   * The opt-out's visible line and its `List-Unsubscribe` header come off **one** field so they
   * cannot disagree, which means a host that cannot form the URL has neither. "Header-only" is the
   * wrong mental model to leave a reader with, so the sentence refuses it explicitly.
   */
  it("says a sending host with no base URL has no opt-out at all, not a header-only one", () => {
    const verdict = summarizeConfig({ ...configured, baseUrl: false });
    const hazard = verdict.hazards.join(" ");
    expect(hazard).toMatch(/no way out of it at all/);
    expect(hazard).toMatch(/not only the List-Unsubscribe header/);
  });

  it("does not raise the opt-out hazard on a host that cannot send anyway", () => {
    const verdict = summarizeConfig({ ...unconfigured, baseUrl: false });
    expect(verdict.hazards.join(" ")).not.toMatch(/opt-out/);
    expect(verdict.caveats.join(" ")).toMatch(/no opt-out/);
  });

  /**
   * An unusable key is not an unset key. The operator already spent the afternoon; telling them to
   * "set DRIVE_TOKEN_KEY" is the sentence that wastes another one.
   */
  it("distinguishes a wrong-length key from an absent one, and says the length", () => {
    const verdict = summarizeConfig({
      ...unconfigured,
      sealing: "unusable",
      sealingKeyBytes: 16,
    });
    const hazard = verdict.hazards.join(" ");
    expect(hazard).toMatch(/16 bytes, not 32/);
    expect(hazard).toMatch(/randomBytes\(32\)/);
    expect(verdict.caveats.join(" ")).not.toMatch(/DRIVE_TOKEN_KEY is unset/);
  });

  /**
   * `googleConfig()` requires `NEXT_PUBLIC_BASE_URL` as well as the two Google variables, so the
   * realistic confusing case is a board that set both Google secrets and cannot work out why the
   * import screen still says "not configured".
   */
  /**
   * `NEXT_PUBLIC_BASE_URL` is a shared variable every deployment sets for its own reasons, so its
   * presence is not somebody having started to configure Drive. Reading it as one made `db:doctor`
   * exit 1 on every developer laptop — found by running the thing rather than by testing it, which
   * is why it is pinned here.
   */
  it("calls Drive off, not partial, on a host that only set the shared base URL", () => {
    const verdict = summarizeConfig({ ...unconfigured, baseUrl: true });
    expect(verdict.hazards).toEqual([]);
    expect(verdict.caveats.join(" ")).toMatch(/Drive import is off/);
  });

  it("blames the base URL when that is the Drive variable actually missing", () => {
    const verdict = summarizeConfig({
      ...configured,
      drive: "partial",
      driveMissing: ["NEXT_PUBLIC_BASE_URL"],
      baseUrl: false,
    });
    expect(verdict.hazards.join(" ")).toMatch(/NEXT_PUBLIC_BASE_URL is unset/);
  });

  it("carries the source through, so a verdict can name whose environment it read", () => {
    const verdict = summarizeConfig({ ...unconfigured, source: { host: "https://example.test" } });
    expect(verdict.source).toEqual({ host: "https://example.test" });
  });
});

describe("the config verdict is not the database verdict", () => {
  /** Guards the split `db:seed` depends on: it gates on `ok`, so a mail key must never touch it. */
  it("never changes the problem list, whatever the configuration is", () => {
    const base = summarizeHealth(healthy, expected);
    const hazardous = summarizeHealth(
      { ...healthy, config: { ...unconfigured, cron: true } },
      expected,
    );

    expect(base.ok).toBe(true);
    expect(hazardous.ok).toBe(true);
    if (!hazardous.ok) throw new Error("unreachable");
    expect(hazardous.config.hazards.length).toBeGreaterThan(0);
  });

  it("reports caveats on a failing verdict too, so a config fact is not lost behind a problem", () => {
    const health = summarizeHealth({ ...unseeded, config: unconfigured }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    expect(health.problems.at(-1)).toMatch(/comp not seeded/);
    expect(health.config.caveats.length).toBeGreaterThan(0);
  });
});

/**
 * Parsed rather than cast, because this arrives over a network from a host named by hand on a
 * command line. A typo'd URL answering somebody else's JSON must not produce a confident verdict.
 */
describe("parseHealthPayload", () => {
  const payload = {
    migrations: { applied: 15, expected: 15 },
    config: {
      sending: "off",
      sendingMissing: ["RESEND_API_KEY", "COMMS_FROM"],
      cron: false,
      baseUrl: true,
      drive: "off",
      driveMissing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      sealing: "off",
      sealingKeyBytes: null,
    },
  };

  it("accepts what the route actually sends", () => {
    expect(parseHealthPayload(payload)?.migrations.applied).toBe(15);
  });

  it("accepts a null applied count, which is a database with no drizzle schema", () => {
    const parsed = parseHealthPayload({ ...payload, migrations: { applied: null, expected: 15 } });
    expect(parsed?.migrations.applied).toBeNull();
  });

  it.each([
    ["not an object", "hello"],
    ["null", null],
    ["no migrations", { config: payload.config }],
    ["no config", { migrations: payload.migrations }],
    ["a string count", { ...payload, migrations: { applied: "15", expected: 15 } }],
    ["an unknown sending state", { ...payload, config: { ...payload.config, sending: "maybe" } }],
    ["a non-boolean cron", { ...payload, config: { ...payload.config, cron: "yes" } }],
    ["a non-array missing list", { ...payload, config: { ...payload.config, driveMissing: "x" } }],
  ])("refuses %s", (_label, value) => {
    expect(parseHealthPayload(value)).toBeNull();
  });
});
