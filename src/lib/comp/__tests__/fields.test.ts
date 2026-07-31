import { describe, expect, it } from "vitest";
import type { CustomField } from "@/db/schema";
import { collectAnswers, fieldInputName, validateAnswers } from "../fields";

const field = (over: Partial<CustomField> & Pick<CustomField, "id" | "type">): CustomField => ({
  label: over.id,
  required: false,
  ...over,
});

describe("validateAnswers", () => {
  it("returns null when the comp asked nothing, rather than an empty object", () => {
    expect(validateAnswers(undefined, {})).toEqual({ ok: true, answers: null });
    expect(validateAnswers([], { anything: "x" })).toEqual({ ok: true, answers: null });
  });

  // The comp's own fields are the whitelist as well as the schema. This runs on the one page with
  // no `Actor` behind it, so the form is not the thing that decides what a stranger may write.
  it("keeps only what a field asked for, so a hand-crafted post writes nothing extra", () => {
    const result = validateAnswers([field({ id: "props", type: "text" })], {
      props: "a ladder",
      smuggled: "should not be stored",
    });

    expect(result).toEqual({ ok: true, answers: { props: "a ladder" } });
  });

  it("refuses a required field that was left blank, naming it the way the applicant read it", () => {
    const result = validateAnswers(
      [field({ id: "arrival_window", label: "Arrival window", type: "text", required: true })],
      { arrival_window: "   " },
    );

    expect(result).toEqual({ ok: false, message: "Arrival window is required." });
  });

  // The message must never carry the id: the applicant never saw it, and it is a schema leak.
  it("never puts a field id in a message an applicant reads", () => {
    const result = validateAnswers(
      [field({ id: "dietary_count", label: "Dietary restrictions", type: "number" })],
      { dietary_count: "not a number" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Dietary restrictions");
      expect(result.message).not.toContain("dietary_count");
    }
  });

  it("lets an optional field go unanswered without recording a blank", () => {
    const result = validateAnswers([field({ id: "notes", type: "text" })], { notes: "" });
    expect(result).toEqual({ ok: true, answers: null });
  });

  it("stores a number as a number, not as the string it arrived as", () => {
    const result = validateAnswers([field({ id: "vans", type: "number" })], { vans: "3" });
    expect(result).toEqual({ ok: true, answers: { vans: 3 } });
  });

  it("refuses a select answer that was not one of the options offered", () => {
    const arrival = field({
      id: "arrival",
      label: "Arrival",
      type: "select",
      options: ["Friday", "Saturday"],
    });

    expect(validateAnswers([arrival], { arrival: "Saturday" })).toEqual({
      ok: true,
      answers: { arrival: "Saturday" },
    });
    expect(validateAnswers([arrival], { arrival: "Sunday" }).ok).toBe(false);
  });

  // An unchecked box submits nothing at all, so absence is an answer here rather than a gap — which
  // is the opposite of every other type, and the reason checkbox is handled before the blank check.
  it("records an unchecked box as false rather than as unanswered", () => {
    const consent = field({ id: "consent", type: "checkbox" });

    expect(validateAnswers([consent], {})).toEqual({ ok: true, answers: { consent: false } });
    expect(validateAnswers([consent], { consent: "on" })).toEqual({
      ok: true,
      answers: { consent: true },
    });
  });

  it("refuses a required checkbox that was not ticked, the way the waiver does", () => {
    const consent = field({ id: "consent", label: "Photo consent", type: "checkbox", required: true });
    expect(validateAnswers([consent], {})).toEqual({
      ok: false,
      message: "Photo consent is required.",
    });
  });

  it("enforces maxLength on the server, because the attribute is only a courtesy", () => {
    const bio = field({ id: "bio", label: "Bio", type: "text", maxLength: 5 });

    expect(validateAnswers([bio], { bio: "short" }).ok).toBe(true);
    expect(validateAnswers([bio], { bio: "far too long" })).toEqual({
      ok: false,
      message: "Bio has to be 5 characters or fewer.",
    });
  });

  it("stops at the first refusal, so an applicant gets one instruction at a time", () => {
    const result = validateAnswers(
      [
        field({ id: "first", label: "First", type: "text", required: true }),
        field({ id: "second", label: "Second", type: "text", required: true }),
      ],
      {},
    );

    expect(result).toEqual({ ok: false, message: "First is required." });
  });
});

describe("collectAnswers", () => {
  it("takes only the namespaced entries, so a built-in field can never be read as an answer", () => {
    const form: [string, string][] = [
      ["teamName", "Kinetic Collective"],
      ["custom.props", "a ladder"],
      ["custom.vans", "3"],
      ["waiver", "on"],
    ];

    expect(collectAnswers(form)).toEqual({ props: "a ladder", vans: "3" });
  });

  it("names an input under the same prefix it is collected from", () => {
    expect(fieldInputName(field({ id: "props", type: "text" }))).toBe("custom.props");
    expect(collectAnswers([[fieldInputName(field({ id: "props", type: "text" })), "x"]])).toEqual({
      props: "x",
    });
  });
});
