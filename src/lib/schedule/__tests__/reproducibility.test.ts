import { describe, expect, it } from "vitest";
import { derive } from "../derive";
import { BUFFERS } from "./fixtures";
import snapshot from "./snapshot.json";
import type { ScheduleInput, ScheduleResult } from "../types";

/**
 * `src/lib/tabulation/__tests__/reproducibility.test.ts`, one directory over, and it exists for the
 * same reason with a different consequence.
 *
 * There, the claim is that a locked placement re-derives a year later. Here, it is that a timeline
 * somebody is standing in re-derives five minutes later — because G5 pushes a change to a phone, and
 * a push is a diff between two derivations. If `derive` is not a function of its arguments alone,
 * the diff is against a schedule that no longer exists, and what lands on the phone is a re-timing
 * nobody caused. The stored run in `schedule_runs` has exactly `tab_runs`' job: it is the record of
 * what a person was actually told.
 *
 * The stored snapshot is deliberately one with a **compound delay that exhausts every declared
 * pool** — two delays from different positions, 21 minutes total against 18 minutes of slack. That
 * is PRD §9 G6's own scenario and the arithmetic most likely to be quietly changed by a refactor,
 * so it is the arithmetic frozen here rather than a clean-day schedule where every number is zero.
 *
 * **If this fails, something that was told to a liaison cannot be reconstructed.** Regenerating the
 * snapshot to make it pass is the one repair that is never correct — the same rule the tabulation
 * test carries, and the reason both files say so out loud.
 */
const stored = snapshot as { input: ScheduleInput; result: ScheduleResult };

describe("derive — reproducibility", () => {
  it("re-derives a stored run bit-identically", () => {
    expect(derive(stored.input, BUFFERS)).toEqual(stored.result);
  });

  it("returns the same answer twice for the same arguments", () => {
    expect(derive(stored.input, BUFFERS)).toEqual(derive(stored.input, BUFFERS));
  });

  /**
   * The property the ESLint fence protects, asserted from the outside as well. A clock read that
   * happens not to change the answer is invisible to the two tests above and stays invisible until
   * the day it isn't — so this one shuffles the inputs instead, because the realistic impurity here
   * is not a `Date` but a dependence on the order Postgres happened to return the rows in.
   */
  it("does not depend on the order the draw or the delays arrived in", () => {
    const shuffled: ScheduleInput = {
      showOrder: [...stored.input.showOrder].reverse(),
      delays: [...stored.input.delays].reverse(),
    };
    expect(derive(shuffled, BUFFERS)).toEqual(stored.result);
  });
});
