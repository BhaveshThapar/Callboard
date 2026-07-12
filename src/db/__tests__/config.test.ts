import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCompConfig } from "../config";
import { DEMO_CONFIG } from "../seed-config";

const valid = () => structuredClone(DEMO_CONFIG) as unknown as Record<string, unknown>;

describe("parseCompConfig", () => {
  it("accepts the demo config unchanged", () => {
    expect(parseCompConfig(valid())).toEqual(DEMO_CONFIG);
  });

  it("accepts the shipped example config", () => {
    const raw = JSON.parse(readFileSync("comp-config.example.json", "utf8")) as unknown;
    const parsed = parseCompConfig(raw);
    expect(parsed.rubric.normalization).toBe("rank");
    expect(parsed.board).toHaveLength(2);
  });

  it("defaults sortOrder, performanceOrder, weightBp, and status", () => {
    const parsed = parseCompConfig({
      org: { name: "O", slug: "o" },
      comp: { name: "C", slug: "c" },
      rubric: { name: "R", normalization: "raw", criteria: [{ label: "A", maxPoints: 10 }] },
      teams: [{ name: "T", bidCode: "A-1" }],
      judges: [{ name: "J" }],
      board: [{ name: "B" }],
    });

    expect(parsed.comp.status).toBe("live");
    expect(parsed.rubric.criteria[0]).toMatchObject({ weightBp: 10_000, sortOrder: 0 });
    expect(parsed.rubric.tiebreakers).toEqual([]);
    expect(parsed.teams[0]?.performanceOrder).toBe(1);
  });

  it("rejects an unknown normalization", () => {
    const config = valid();
    (config.rubric as Record<string, unknown>).normalization = "bayesian";
    expect(() => parseCompConfig(config)).toThrow(/rubric.normalization.*raw, zscore, rank/);
  });

  it("rejects a criterion worth zero or fewer points", () => {
    const config = valid();
    (config.rubric as { criteria: { maxPoints: number }[] }).criteria[0]!.maxPoints = 0;
    expect(() => parseCompConfig(config)).toThrow(/maxPoints.*above zero/);
  });

  it("rejects a negative weight", () => {
    const config = valid();
    (config.rubric as { criteria: { weightBp: number }[] }).criteria[0]!.weightBp = -1;
    expect(() => parseCompConfig(config)).toThrow(/weightBp.*zero or more/);
  });

  it("rejects duplicate bid codes, which would collide on the unique constraint", () => {
    const config = valid();
    (config.teams as { bidCode: string }[])[1]!.bidCode = "A-114";
    expect(() => parseCompConfig(config)).toThrow(/bid codes to be unique/);
  });

  it("rejects a criterion tiebreaker naming a criterion that does not exist", () => {
    const config = valid();
    (config.rubric as Record<string, unknown>).tiebreakers = [
      { kind: "criterion", criterion: "Stagecraft" },
    ];
    expect(() => parseCompConfig(config)).toThrow(/a criterion label that exists \(Stagecraft\)/);
  });

  it("accepts a criterion tiebreaker naming a criterion that does exist", () => {
    const config = valid();
    (config.rubric as Record<string, unknown>).tiebreakers = [
      { kind: "criterion", criterion: "Execution" },
    ];
    expect(parseCompConfig(config).rubric.tiebreakers).toEqual([
      { kind: "criterion", criterion: "Execution" },
    ]);
  });

  it("rejects a comp with no board member, because a lock would have nobody to attribute", () => {
    const config = valid();
    config.board = [];
    expect(() => parseCompConfig(config)).toThrow(/board.*at least one board member/);
  });

  it("rejects empty teams, judges, and criteria", () => {
    for (const key of ["teams", "judges"] as const) {
      const config = valid();
      config[key] = [];
      expect(() => parseCompConfig(config)).toThrow(new RegExp(`${key}.*at least one`));
    }

    const config = valid();
    (config.rubric as Record<string, unknown>).criteria = [];
    expect(() => parseCompConfig(config)).toThrow(/at least one criterion/);
  });

  it("rejects a missing section rather than seeding a half-built comp", () => {
    const config = valid();
    delete config.rubric;
    expect(() => parseCompConfig(config)).toThrow(/rubric: expected an object/);
  });

  it("names the path of a bad field", () => {
    const config = valid();
    (config.teams as { name: unknown }[])[2]!.name = 42;
    expect(() => parseCompConfig(config)).toThrow(/teams\[2\].name: expected a non-empty string/);
  });

  /**
   * A comp is one division (ADR-0010). Nothing downstream is division-aware, so a config carrying
   * two of them does not describe two competitions — it describes one wrong one. These are the two
   * ways a config can declare a second division, and the parser is the only thing that sees both.
   */
  describe("divisions", () => {
    it("rejects a roster split across two divisions", () => {
      const config = valid();
      (config.teams as { division: string }[])[0]!.division = "classical";
      expect(() => parseCompConfig(config)).toThrow(
        /declares 2 divisions \(classical, fusion\).*separate comps/s,
      );
    });

    it("rejects a panel split across two divisions", () => {
      const config = valid();
      (config.judges as { division?: string }[])[0]!.division = "classical";
      expect(() => parseCompConfig(config)).toThrow(/declares 2 divisions \(classical, fusion\)/);
    });

    it("rejects a judge judging a division the roster does not have", () => {
      const config = valid();
      for (const team of config.teams as { division?: string }[]) delete team.division;
      (config.judges as { division?: string }[])[0]!.division = "classical";
      (config.judges as { division?: string }[])[1]!.division = "fusion";
      expect(() => parseCompConfig(config)).toThrow(/declares 2 divisions/);
    });

    it("accepts one division, which is a label and not a scoping key", () => {
      expect(parseCompConfig(valid()).teams[0]?.division).toBe("fusion");
    });

    it("accepts a comp that names no division at all", () => {
      const config = valid();
      for (const team of config.teams as { division?: string }[]) delete team.division;
      expect(parseCompConfig(config).teams[0]?.division).toBeUndefined();
    });

    it("accepts an unlabelled row beside a labelled one: that is a missing label, not a division", () => {
      const config = valid();
      delete (config.teams as { division?: string }[])[0]!.division;
      expect(() => parseCompConfig(config)).not.toThrow();
    });

    it("never carries a judge's division through: it is read only to refuse a second one", () => {
      const config = valid();
      for (const judge of config.judges as { division?: string }[]) judge.division = "fusion";
      expect(parseCompConfig(config).judges[0]).toEqual({
        name: "Priya Raghavan",
        email: "priya@example.com",
      });
    });
  });
});
