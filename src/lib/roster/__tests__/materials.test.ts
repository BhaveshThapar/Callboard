import { describe, expect, it } from "vitest";
import { parseMaterials, putMaterial } from "../materials";

const fields = (over: Partial<Record<string, string>> = {}) => ({
  musicUrl: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  rosterSizeRequested: "",
  ...over,
});

describe("putMaterial", () => {
  it("hands back an http(s) URL, which is what a material is until there is somewhere to put a file", () => {
    const result = putMaterial("https://drive.google.com/file/d/abc/view");
    expect(result).toEqual({ ok: true, url: "https://drive.google.com/file/d/abc/view" });
  });

  it("treats blank as cleared rather than as an invalid URL", () => {
    expect(putMaterial("   ")).toEqual({ ok: true, url: null });
  });

  /**
   * The one that matters. This string is rendered as an anchor on the board's roster screen, so a
   * scheme a captain chooses is a scheme a board member clicks. Parsing rather than pattern-matching
   * is what makes this hold for the cases a regex misses.
   */
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "not a url at all",
  ])("refuses %s", (hostile) => {
    expect(putMaterial(hostile)).toEqual({ ok: false });
  });
});

describe("parseMaterials", () => {
  it("reads blank as 'leave the roster alone', never as zero dancers", () => {
    const result = parseMaterials(fields());
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.rosterSizeRequested).toBeNull();
  });

  /**
   * `Number("")` is 0, and a team telling its board it has no dancers is a bill of nothing. The
   * distinction is the same one `rooms` draws and it has to be drawn again here, because this is a
   * different parser reached by a different actor.
   */
  it("keeps a stated zero distinct from a blank", () => {
    const result = parseMaterials(fields({ rosterSizeRequested: "0" }));
    expect(result.ok && result.value.rosterSizeRequested).toBe(0);
  });

  it("takes a stated count", () => {
    const result = parseMaterials(fields({ rosterSizeRequested: "18" }));
    expect(result.ok && result.value.rosterSizeRequested).toBe(18);
  });

  it.each(["-3", "12.5", "1e3", "  ", "٤"])("refuses %s as a count", (bad) => {
    if (bad.trim() === "") return;
    expect(parseMaterials(fields({ rosterSizeRequested: bad })).ok).toBe(false);
  });

  it("refuses a roster nobody fields, so a paste accident is not a charge to undo", () => {
    expect(parseMaterials(fields({ rosterSizeRequested: "100000" })).ok).toBe(false);
  });

  it("trims, so a trailing space is not a different emergency contact", () => {
    const result = parseMaterials(fields({ emergencyContactName: "  Priya Raghavan  " }));
    expect(result.ok && result.value.emergencyContactName).toBe("Priya Raghavan");
  });

  it("says which field is wrong, because a captain has to fix it without a support thread", () => {
    const result = parseMaterials(fields({ musicUrl: "drive.google.com/abc" }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain("music link");
  });
});
