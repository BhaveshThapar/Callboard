import { describe, expect, it } from "vitest";
import { planRubric } from "../plan";
import type { CriterionEdit, CriterionState } from "../plan";

const criterion = (over: Partial<CriterionState> & { id: string }): CriterionState => ({
  label: "Choreography",
  maxPoints: 30,
  weightBp: 10_000,
  sortOrder: 0,
  scoreCount: 0,
  ...over,
});

const edit = (over: Partial<CriterionEdit> = {}): CriterionEdit => ({
  label: "Choreography",
  maxPoints: 30,
  weightBp: 10_000,
  sortOrder: 0,
  ...over,
});

const open = { locked: false };

describe("planRubric — what changes", () => {
  it("adds a criterion that has no id", () => {
    const plan = planRubric([], [edit({ label: "Execution" })], open);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.insert).toHaveLength(1);
    expect(plan.update).toEqual([]);
    expect(plan.delete).toEqual([]);
  });

  it("reports nothing to do when nothing moved", () => {
    const current = [criterion({ id: "a" })];
    const plan = planRubric(current, [edit({ id: "a" })], open);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan).toMatchObject({ insert: [], update: [], delete: [], unchanged: ["a"] });
  });

  it("deletes a criterion nobody has scored", () => {
    const current = [criterion({ id: "a" }), criterion({ id: "b", label: "Execution" })];
    const plan = planRubric(current, [edit({ id: "a" })], open);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.delete).toEqual(["b"]);
  });

  it("refuses an id the rubric no longer holds, rather than inserting it", () => {
    const plan = planRubric([criterion({ id: "a" })], [edit({ id: "ghost" })], open);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toMatch(/changed while you were editing/);
  });
});

/**
 * The rules that exist because `scores.criterion_id` cascades on delete. The database's answer to
 * each of these is "yes, done" — and it takes a judge's work with it.
 */
describe("planRubric — a scored criterion", () => {
  const scored = [criterion({ id: "a", scoreCount: 24 })];

  it("cannot be deleted, and the refusal says what to do instead", () => {
    const plan = planRubric(scored, [edit({ label: "New", maxPoints: 10 })], open);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toMatch(/24 scores against it/);
    expect(plan.message).toMatch(/delete those scores too/);
    expect(plan.message).toMatch(/weight to zero/);
  });

  it("cannot be re-scaled, because that restates every score already given", () => {
    const plan = planRubric(scored, [edit({ id: "a", maxPoints: 50 })], open);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toMatch(/24 out of 30 is not a 24 out of 50/);
  });

  it("cannot be re-weighted either — that is what the aggregate multiplies by", () => {
    expect(planRubric(scored, [edit({ id: "a", weightBp: 5_000 })], open).ok).toBe(false);
  });

  it("can still be reworded, because rewording a question does not change the answers", () => {
    const plan = planRubric(scored, [edit({ id: "a", label: "Choreography & staging" })], open);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.update).toEqual([
      { id: "a", label: "Choreography & staging", maxPoints: 30, weightBp: 10_000, sortOrder: 0 },
    ]);
  });

  it("can be reordered, which moves it on a judge's form and nothing else", () => {
    const plan = planRubric(scored, [edit({ id: "a", sortOrder: 3 })], open);
    expect(plan.ok).toBe(true);
  });
});

describe("planRubric — refusals that are about the rubric being usable", () => {
  it("refuses everything once results are locked", () => {
    const plan = planRubric([criterion({ id: "a" })], [edit({ id: "a" })], { locked: true });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toMatch(/reproduces from its own frozen copy/);
  });

  it("refuses an empty rubric", () => {
    expect(planRubric([criterion({ id: "a" })], [], open).ok).toBe(false);
  });

  it("refuses a criterion worth zero points", () => {
    expect(planRubric([], [edit({ maxPoints: 0 })], open).ok).toBe(false);
    expect(planRubric([], [edit({ maxPoints: 2.5 })], open).ok).toBe(false);
  });

  it("refuses a blank label, which is what a judge would be asked to fill in", () => {
    expect(planRubric([], [edit({ label: "   " })], open).ok).toBe(false);
  });

  it("refuses a negative weight, but allows zero — that is how a criterion is retired", () => {
    expect(planRubric([], [edit({ weightBp: -1 })], open).ok).toBe(false);
    const plan = planRubric([], [edit({ weightBp: 0 }), edit({ label: "B", weightBp: 10_000 })], open);
    expect(plan.ok).toBe(true);
  });

  it("refuses a rubric where everything is weighted zero, because nothing would count", () => {
    const plan = planRubric([], [edit({ weightBp: 0 })], open);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toMatch(/nothing would count/);
  });
});
