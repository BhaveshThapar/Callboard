import { describe, expect, it } from "vitest";
import { COMP_STATUSES } from "@/db/schema";
import { canAdvanceComp, COMP_STATUS_MEANING, nextCompStatuses } from "../lifecycle";

describe("the comp lifecycle", () => {
  it("opens registration and closes it, which is the whole reason it exists", () => {
    // Before this map, `comps.status` had one writer — the seed script — so the only way to close a
    // form was to reseed the comp, which reissues every token and kills the links already handed
    // out (ADR-0013). Closing a form meant destroying the comp.
    expect(canAdvanceComp("draft", "open")).toBe(true);
    expect(canAdvanceComp("open", "live")).toBe(true);
    expect(canAdvanceComp("open", "complete")).toBe(true);
    expect(canAdvanceComp("live", "complete")).toBe(true);
  });

  it("never reopens: an application must not land against a comp being scored", () => {
    expect(canAdvanceComp("live", "open")).toBe(false);
    expect(canAdvanceComp("complete", "open")).toBe(false);
    expect(canAdvanceComp("complete", "live")).toBe(false);
    // ...nor back to draft, which would un-announce a comp teams have already seen.
    expect(canAdvanceComp("open", "draft")).toBe(false);
  });

  it("refuses a comp staying where it is, so a click always means something", () => {
    for (const status of COMP_STATUSES) {
      expect(canAdvanceComp(status, status)).toBe(false);
    }
  });

  it("is total: every status has an answer for every other", () => {
    // The property `transitions.ts` holds for teams. A missing key here is a runtime crash on a
    // status somebody added to the enum and not to the map.
    for (const from of COMP_STATUSES) {
      expect(nextCompStatuses(from)).toBeDefined();
      expect(COMP_STATUS_MEANING[from]).toBeTruthy();
      for (const to of COMP_STATUSES) {
        expect(typeof canAdvanceComp(from, to)).toBe("boolean");
      }
    }
  });

  it("ends at complete, because an ending that can be walked back is not one", () => {
    expect(nextCompStatuses("complete")).toEqual([]);
  });

  it("offers exactly what the buttons render — there is no second list", () => {
    expect(nextCompStatuses("draft")).toEqual(["open"]);
    expect(nextCompStatuses("open")).toEqual(["live", "complete"]);
    expect(nextCompStatuses("live")).toEqual(["complete"]);
  });
});
