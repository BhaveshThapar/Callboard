import type { CustomAnswer, CustomField } from "@/db/schema";

export type AnswerResult =
  | { ok: true; answers: Record<string, CustomAnswer> | null }
  | { ok: false; message: string };

/**
 * The namespace a custom field's input lives under on the form, and the whole of what keeps a
 * board-authored id from colliding with a built-in field name: they share one `FormData`, and this
 * is what makes them share nothing else. A list of reserved names would be the alternative, and a
 * worse one — it has to be kept in step with the form by hand, and it reads as protection while
 * only covering the names somebody remembered.
 *
 * It is also what lets the action collect answers *before* it knows which comp it is for: the
 * prefix is the whole of what it needs, so a refusal from a closed comp still echoes back what the
 * applicant typed.
 */
export const CUSTOM_FIELD_PREFIX = "custom.";

export const fieldInputName = (field: CustomField): string => `${CUSTOM_FIELD_PREFIX}${field.id}`;

export const collectAnswers = (form: Iterable<[string, FormDataEntryValue]>): Record<string, string> =>
  Object.fromEntries(
    [...form]
      .filter(([key]) => key.startsWith(CUSTOM_FIELD_PREFIX))
      .map(([key, value]) => [key.slice(CUSTOM_FIELD_PREFIX.length), String(value)]),
  );

const missing = (field: CustomField): string => `${field.label} is required.`;

/**
 * Validates a comp's own questions against what was actually submitted, and returns the answers in
 * the shape they are stored in.
 *
 * The comp's `fields` are both the schema and the whitelist: an answer arrives only if a field
 * asked for it, so a hand-crafted POST carrying `custom.anything` writes nothing. That matters more
 * than it looks — this runs on the one page with no `Actor` behind it, so the form is the only
 * thing describing what a stranger may write, and it must not be the thing being trusted.
 *
 * One message at a time, naming the field's **label** rather than its id, matching every other
 * refusal in `apply`: the applicant reads labels, and an error saying `props_needed is required`
 * is a schema leak and an unanswerable instruction at the same time.
 *
 * Returns `null` rather than `{}` when a comp asks nothing, so "this comp had no questions" and
 * "this team answered none of them" stay distinguishable in the column a year later.
 */
export const validateAnswers = (
  fields: readonly CustomField[] | undefined,
  raw: Readonly<Record<string, string>>,
): AnswerResult => {
  if (!fields || fields.length === 0) return { ok: true, answers: null };

  const answers: Record<string, CustomAnswer> = {};

  for (const field of fields) {
    const submitted = (raw[field.id] ?? "").trim();

    if (field.type === "checkbox") {
      // An unchecked box submits nothing at all, so absence is the answer rather than a gap. A
      // required checkbox is the waiver pattern: it must be ticked, not merely present.
      const checked = submitted !== "";
      if (field.required && !checked) return { ok: false, message: missing(field) };
      answers[field.id] = checked;
      continue;
    }

    if (submitted === "") {
      if (field.required) return { ok: false, message: missing(field) };
      continue;
    }

    if (field.type === "number") {
      const value = Number(submitted);
      if (!Number.isFinite(value)) {
        return { ok: false, message: `${field.label} has to be a number.` };
      }
      answers[field.id] = value;
      continue;
    }

    if (field.type === "select") {
      if (!field.options?.includes(submitted)) {
        return { ok: false, message: `${field.label} has to be one of the options offered.` };
      }
      answers[field.id] = submitted;
      continue;
    }

    if (field.maxLength !== undefined && submitted.length > field.maxLength) {
      return {
        ok: false,
        message: `${field.label} has to be ${field.maxLength} characters or fewer.`,
      };
    }
    answers[field.id] = submitted;
  }

  return { ok: true, answers: Object.keys(answers).length === 0 ? null : answers };
};
