import { describe, expect, it } from "vitest";
import { toCsv } from "../csv";

describe("toCsv", () => {
  it("writes a header row and CRLF line endings", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2");
  });

  it("quotes a field containing a comma", () => {
    expect(toCsv(["note"], [["exceeded time, then fell"]])).toBe('note\r\n"exceeded time, then fell"');
  });

  it("doubles an embedded quote, and quotes the field", () => {
    expect(toCsv(["note"], [['she said "go"']])).toBe('note\r\n"she said ""go"""');
  });

  it("quotes a field containing a newline, so the row is not split", () => {
    const csv = toCsv(["note"], [["line one\nline two"]]);
    expect(csv).toBe('note\r\n"line one\nline two"');
  });

  it("leaves an ordinary field unquoted", () => {
    expect(toCsv(["team"], [["NCSU Nazaare"]])).toBe("team\r\nNCSU Nazaare");
  });

  it("emits only a header when there are no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe("a,b");
  });
});
