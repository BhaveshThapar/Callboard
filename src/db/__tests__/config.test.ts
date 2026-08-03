import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCompConfig } from "../config";
import { DEMO_CONFIG } from "../seed-config";

const valid = () => structuredClone(DEMO_CONFIG) as unknown as Record<string, unknown>;

/**
 * The smallest config that parses. Used where the assertion is about a field being *absent*, which
 * `DEMO_CONFIG` cannot answer -- it carries a fee schedule and room counts of its own, so asserting
 * absence against it tests the demo rather than the default.
 */
const minimal = (): Record<string, unknown> => ({
  org: { name: "O", slug: "o" },
  comp: { name: "C", slug: "c" },
  rubric: { name: "R", normalization: "raw", criteria: [{ label: "A", maxPoints: 10 }] },
  teams: [{ name: "T", bidCode: "A-1" }],
  judges: [{ name: "J" }],
  board: [{ name: "B" }],
});

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

  /**
   * The registration block is the public form, and the config is the only door it comes through —
   * so a form that cannot be rendered, or whose answers cannot be checked, has to be refused here
   * rather than discovered by a captain at 1am on the deadline.
   */
  describe("registration", () => {
    const withRegistration = (registration: unknown): Record<string, unknown> => ({
      ...valid(),
      registration,
    });

    const base = { waiverText: "Compete at your own risk.", requireAuditionUrl: true };

    it("keeps the form a board authored, and defaults requireAuditionUrl to false", () => {
      const parsed = parseCompConfig(withRegistration({ waiverText: "Risk." }));
      expect(parsed.registration).toEqual({
        waiverText: "Risk.",
        requireAuditionUrl: false,
        maxRosterSize: undefined,
        fields: undefined,
      });
    });

    it("requires the waiver text, because it is the board's own and has no default", () => {
      expect(() => parseCompConfig(withRegistration({ requireAuditionUrl: true }))).toThrow(
        /registration.waiverText/,
      );
    });

    it("refuses a roster cap of zero", () => {
      expect(() => parseCompConfig(withRegistration({ ...base, maxRosterSize: 0 }))).toThrow(
        /registration.maxRosterSize: expected a value above zero/,
      );
    });

    it("refuses a division field on the form (ADR-0010)", () => {
      expect(() => parseCompConfig(withRegistration({ ...base, division: "fusion" }))).toThrow(
        /registration.division.*ADR-0010/s,
      );
    });

    describe("custom fields", () => {
      const fields = (...f: unknown[]) => withRegistration({ ...base, fields: f });

      it("keeps a board's own questions, in the order it asked them", () => {
        const parsed = parseCompConfig(
          fields(
            { id: "props", label: "Props needed", type: "text", required: true, maxLength: 200 },
            { id: "arrival", label: "Arrival", type: "select", options: ["Friday", "Saturday"] },
          ),
        );

        expect(parsed.registration?.fields?.map((f) => f.id)).toEqual(["props", "arrival"]);
        expect(parsed.registration?.fields?.[0]?.required).toBe(true);
        expect(parsed.registration?.fields?.[1]?.required).toBe(false);
        expect(parsed.registration?.fields?.[1]?.options).toEqual(["Friday", "Saturday"]);
      });

      // The id is the key answers are stored under, so a duplicate is one question silently
      // overwriting another's answers — which is unrecoverable once applications start arriving.
      it("refuses two fields sharing an id", () => {
        expect(() =>
          parseCompConfig(
            fields({ id: "props", label: "A", type: "text" }, { id: "props", label: "B", type: "text" }),
          ),
        ).toThrow(/no other field uses/);
      });

      // The id names a key in `teams.custom_answers` forever, so it is constrained to something
      // that stays readable in the raw json a board may one day be handed.
      it("refuses an id that is not a usable storage key", () => {
        for (const id of ["Props Needed", "teamName", "9lives", "props-needed", ""]) {
          expect(() => parseCompConfig(fields({ id, label: "X", type: "text" }))).toThrow(
            /registration.fields\[0\].id/,
          );
        }
      });

      it("refuses a type nothing can render", () => {
        expect(() => parseCompConfig(fields({ id: "props", label: "X", type: "file" }))).toThrow(
          /registration.fields\[0\].type: expected one of/,
        );
      });

      it("refuses a select with fewer than two choices", () => {
        expect(() =>
          parseCompConfig(fields({ id: "arrival", label: "X", type: "select", options: ["Friday"] })),
        ).toThrow(/at least two choices/);
      });

      it("refuses a select with no choices at all", () => {
        expect(() => parseCompConfig(fields({ id: "arrival", label: "X", type: "select" }))).toThrow(
          /registration.fields\[0\].options/,
        );
      });

      it("names the offending field by index, so a long form says which one", () => {
        expect(() =>
          parseCompConfig(
            fields({ id: "ok", label: "Fine", type: "text" }, { id: "bad", type: "text" }),
          ),
        ).toThrow(/registration.fields\[1\].label/);
      });
    });
  });
  describe("feeSchedule", () => {
    const withFee = (fee: unknown) => ({ ...valid(), feeSchedule: fee });

    it("is absent when unstated, which bills nothing rather than billing zero", () => {
      expect(parseCompConfig(minimal()).feeSchedule).toBeUndefined();
    });

    it("accepts Mayuri 2026's numbers", () => {
      const parsed = parseCompConfig(
        withFee({
          perDancerCents: 7000,
          perRoomCents: 14000,
          depositCents: 10000,
          lateFeeCents: 2500,
          lateAfter: "2027-02-01",
        }),
      );
      expect(parsed.feeSchedule).toEqual({
        perDancerCents: 7000,
        perRoomCents: 14000,
        depositCents: 10000,
        lateFeeCents: 2500,
        lateAfter: "2027-02-01",
      });
    });

    it("defaults every unstated component to zero", () => {
      expect(parseCompConfig(withFee({ depositCents: 10000 })).feeSchedule).toEqual({
        perDancerCents: 0,
        perRoomCents: 0,
        depositCents: 10000,
        lateFeeCents: 0,
        lateAfter: undefined,
      });
    });

    // This is where ADR-0002 stops being a convention. 70.5 means $70.50 to whoever typed it and
    // 70.5 cents to the parser, and the difference only ever surfaces on a bank statement.
    it("refuses a non-integer cents value, naming the path", () => {
      expect(() => parseCompConfig(withFee({ perDancerCents: 70.5 }))).toThrow(
        /feeSchedule.perDancerCents: expected a whole number/,
      );
    });

    it("refuses a negative amount", () => {
      expect(() => parseCompConfig(withFee({ depositCents: -1 }))).toThrow(
        /feeSchedule.depositCents: expected a value of zero or more/,
      );
    });

    it("refuses a late fee with no date, which would never apply", () => {
      expect(() => parseCompConfig(withFee({ lateFeeCents: 2500 }))).toThrow(
        /feeSchedule.lateAfter/,
      );
    });

    it("refuses a late date with no fee, which would charge nothing", () => {
      expect(() => parseCompConfig(withFee({ lateAfter: "2027-02-01" }))).toThrow(
        /feeSchedule.lateFeeCents/,
      );
    });

    it("refuses a late date that is not an ISO date", () => {
      expect(() =>
        parseCompConfig(withFee({ lateFeeCents: 2500, lateAfter: "Feb 1 2027" })),
      ).toThrow(/an ISO date/);
    });
  });

  describe("teams[].rooms", () => {
    it("is undefined when unstated, which is not-yet-known rather than zero", () => {
      expect(parseCompConfig(minimal()).teams[0]?.rooms).toBeUndefined();
    });

    it("refuses a non-integer room count", () => {
      const config = valid();
      (config.teams as Record<string, unknown>[])[0]!.rooms = 2.5;
      expect(() => parseCompConfig(config)).toThrow(/teams\[0\].rooms/);
    });
  });

  /**
   * The captain A10 chases. Absent is legitimate — a scoring-only config has no reason to name one —
   * and the consequence of absence is stated rather than silent: the reminder button declines to
   * chase a team it cannot reach, and says which.
   */
  describe("teams[].contact", () => {
    it("is undefined when unstated, which is a team nothing can chase", () => {
      expect(parseCompConfig(minimal()).teams[0]?.contact).toBeUndefined();
    });

    it("normalizes the address, so one captain across two comps is one person", () => {
      const config = minimal();
      (config.teams as Record<string, unknown>[])[0]!.contact = {
        name: "  Meera Iyer ",
        email: "  Meera@Example.COM ",
      };
      expect(parseCompConfig(config).teams[0]?.contact).toEqual({
        name: "Meera Iyer",
        email: "meera@example.com",
      });
    });

    it("refuses an address that is not one, naming the field rather than bouncing later", () => {
      const config = minimal();
      (config.teams as Record<string, unknown>[])[0]!.contact = { name: "M", email: "not-an-email" };
      expect(() => parseCompConfig(config)).toThrow(/teams\[0\].contact.email/);
    });

    it("refuses a contact with no name to address", () => {
      const config = minimal();
      (config.teams as Record<string, unknown>[])[0]!.contact = { email: "m@example.com" };
      expect(() => parseCompConfig(config)).toThrow(/teams\[0\].contact.name/);
    });
  });
});
