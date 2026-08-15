import { describe, expect, it } from "vitest";
import { isImportable, parseCsv, parseRoster } from "../parse";

describe("parseCsv", () => {
  it("reads quoted fields with embedded commas, which is how a school name arrives", () => {
    expect(parseCsv('Team,School\nNazaare,"NC State, Raleigh"')).toEqual([
      ["Team", "School"],
      ["Nazaare", "NC State, Raleigh"],
    ]);
  });

  it('unescapes "" inside a quoted field', () => {
    expect(parseCsv('Team\n"The ""A"" Team"')).toEqual([["Team"], ['The "A" Team']]);
  });

  it("keeps an embedded newline inside quotes as one field, not two rows", () => {
    expect(parseCsv('Team,Note\nNazaare,"line one\nline two"')).toEqual([
      ["Team", "Note"],
      ["Nazaare", "line one\nline two"],
    ]);
  });

  it("treats CRLF as one break", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops spacer rows, because a board's sheet has them and none is a team", () => {
    expect(parseCsv("Team\nNazaare\n\n\nZeal")).toEqual([["Team"], ["Nazaare"], ["Zeal"]]);
  });

  /** Sheets exports one, and it would otherwise become part of the first header and match nothing. */
  it("strips a UTF-8 BOM", () => {
    const parsed = parseRoster("﻿Team,Dancers\nNazaare,18");
    expect(parsed.mapping.name).toBe("Team");
  });
});

describe("parseRoster", () => {
  const CSV = [
    "Team Name,School,Dancers,Rooms,Captain,Captain Email",
    "NCSU Nazaare,NC State,18,4,Priya Raghavan,priya@example.com",
    "Maryland Zeal,UMD,22,5,Arjun Mehta,arjun@example.com",
  ].join("\n");

  it("maps headers a board plausibly typed, and says which column it read each field from", () => {
    const parsed = parseRoster(CSV);
    expect(parsed.mapping).toEqual({
      name: "Team Name",
      school: "School",
      rosterSize: "Dancers",
      rooms: "Rooms",
      contactName: "Captain",
      contactEmail: "Captain Email",
    });
    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.candidates[0]).toMatchObject({
      row: 2,
      name: "NCSU Nazaare",
      rosterSize: 18,
      rooms: 4,
      contactEmail: "priya@example.com",
      problems: [],
    });
  });

  it("is case- and spacing-insensitive about headers", () => {
    const parsed = parseRoster("  TEAM  ,  # DANCERS \nNazaare,18");
    expect(parsed.mapping.name).toBe("TEAM");
    expect(parsed.candidates[0]?.rosterSize).toBe(18);
  });

  it("reports columns it did not understand rather than discarding them silently", () => {
    const parsed = parseRoster("Team,Bid Points,Notes\nNazaare,12,ok");
    expect(parsed.unmappedHeaders).toEqual(["Bid Points", "Notes"]);
  });

  it("keeps blank distinct from zero", () => {
    const parsed = parseRoster("Team,Dancers,Rooms\nNazaare,,0");
    expect(parsed.candidates[0]?.rosterSize).toBeNull();
    expect(parsed.candidates[0]?.rooms).toBe(0);
  });

  /**
   * The rule the whole importer rests on: a row it cannot read comes back as a *candidate with a
   * problem*, never as a dropped row. An importer that quietly ingested 34 of 36 teams is the
   * failure this product is sold against.
   */
  it("surfaces an unreadable number instead of dropping the row", () => {
    const parsed = parseRoster("Team,Dancers\nNazaare,18 or 19");
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.rosterSize).toBeNull();
    expect(parsed.candidates[0]?.problems).toEqual([
      { kind: "unreadable-number", column: "rosterSize", raw: "18 or 19" },
    ]);
  });

  it("flags an address that is not one, and does not lowercase it into the record", () => {
    const parsed = parseRoster("Team,Email\nNazaare,priya at example dot com");
    expect(parsed.candidates[0]?.contactEmail).toBeNull();
    expect(parsed.candidates[0]?.problems[0]).toMatchObject({ kind: "unreadable-email" });
  });

  it("lowercases an address that is one, because people is keyed on it", () => {
    const parsed = parseRoster("Team,Email\nNazaare,Priya@Example.COM");
    expect(parsed.candidates[0]?.contactEmail).toBe("priya@example.com");
  });

  it("names a duplicate against the row it duplicates, and points at the spreadsheet's own numbering", () => {
    const parsed = parseRoster("Team\nNazaare\nZeal\nnazaare");
    expect(parsed.candidates[2]?.problems).toEqual([{ kind: "duplicate-name", of: 2 }]);
    expect(isImportable(parsed.candidates[2]!)).toBe(false);
    expect(isImportable(parsed.candidates[0]!)).toBe(true);
  });

  it("flags a nameless row rather than inventing a team", () => {
    const parsed = parseRoster("Team,Dancers\n,18");
    expect(parsed.candidates[0]?.problems).toEqual([{ kind: "missing-name" }]);
    expect(isImportable(parsed.candidates[0]!)).toBe(false);
  });

  it("returns nothing at all for an empty sheet rather than throwing", () => {
    expect(parseRoster("")).toEqual({ mapping: {}, unmappedHeaders: [], candidates: [] });
  });

  it("survives a sheet with headers and no rows", () => {
    expect(parseRoster("Team,Dancers").candidates).toEqual([]);
  });
});

/**
 * Found by an adversarial review of this branch, and it survived every attempt to refute it.
 *
 * `parseCsv` drops blank rows, which a board's spreadsheet is full of. Numbering the survivors made
 * `TeamCandidate.row` — which promises "the row of the spreadsheet, so a board can go look" — drift
 * by one per spacer above it, and took `duplicate-name.of` and the `sourceRow` written to
 * `audit_log` with it. A row number that points at the wrong row is worse than none, because a board
 * acts on it.
 */
describe("row numbers point at the spreadsheet, not at the surviving rows", () => {
  it("skips the line numbers of spacer rows rather than renumbering past them", () => {
    const parsed = parseRoster("Team,Dancers\nNazaare,18\n\n\nZeal,22");
    expect(parsed.candidates.map((c) => ({ name: c.name, row: c.row }))).toEqual([
      { name: "Nazaare", row: 2 },
      { name: "Zeal", row: 5 },
    ]);
  });

  it("numbers correctly when the header itself is pushed down by blank lines", () => {
    const parsed = parseRoster("\n\nTeam,Dancers\nNazaare,18");
    expect(parsed.candidates[0]?.row).toBe(4);
  });

  it("points a duplicate at the real line of the row it duplicates", () => {
    const parsed = parseRoster("Team\nNazaare\n\nZeal\n\nnazaare");
    expect(parsed.candidates.map((c) => c.row)).toEqual([2, 4, 6]);
    expect(parsed.candidates[2]?.problems).toEqual([{ kind: "duplicate-name", of: 2 }]);
  });

  it("reports a record spanning physical lines at the line it started on", () => {
    const parsed = parseRoster('Team,School\nNazaare,"NC State\nRaleigh"\nZeal,UMD');
    expect(parsed.candidates.map((c) => ({ name: c.name, row: c.row }))).toEqual([
      { name: "Nazaare", row: 2 },
      { name: "Zeal", row: 4 },
    ]);
  });

  it("handles CRLF spacers the same way", () => {
    const parsed = parseRoster("Team\r\nNazaare\r\n\r\nZeal");
    expect(parsed.candidates.map((c) => c.row)).toEqual([2, 4]);
  });
});
