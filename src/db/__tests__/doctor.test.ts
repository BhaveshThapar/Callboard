import { describe, expect, it } from "vitest";
import type { Observed } from "../health";
import { summarizeHealth } from "../health";

const healthy: Observed = {
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
};

const unseeded: Observed = {
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

  it("reports missing money constraints, and names the migration rather than a reseed", () => {
    const health = summarizeHealth({ ...healthy, moneyGuaranteeEnforced: false }, expected);
    expect(health.ok).toBe(false);
    if (health.ok) throw new Error("unreachable");
    const money = health.problems.find((p) => p.includes("allocated past"));
    expect(money).toMatch(/predates migration 0009/);
    expect(money).toMatch(/db:migrate/);
    // Reseeding does not create a constraint, so it must not be offered as the remedy.
    expect(money).not.toMatch(/db:seed/);
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
