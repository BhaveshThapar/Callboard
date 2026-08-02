import { describe, expect, it } from "vitest";
import type { Observed } from "../health";
import { summarizeHealth } from "../health";

const healthy: Observed = {
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
  duplicateInvitations: [],
};

const unseeded: Observed = {
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
  duplicateInvitations: [],
};

const expected = { judges: 3, teams: 8 };

describe("summarizeHealth", () => {
  it("passes a fully seeded demo", () => {
    const health = summarizeHealth(healthy, expected);
    expect(health).toEqual({ ok: true, board: "Ananya Krishnan", judges: 3, teams: 8 });
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
