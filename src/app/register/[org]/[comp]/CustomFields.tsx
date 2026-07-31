import { cx, inputClass } from "@/components/styles";
import type { CustomField } from "@/db/schema";
import { fieldInputName } from "@/lib/comp/fields";

const labelClass = "text-body font-medium text-heading";
const hintClass = "mt-0.5 text-caption text-muted";

/**
 * The comp's own questions, rendered from the same config that validates their answers.
 *
 * Everything here is a courtesy to an honest applicant — `required`, `maxLength`, the option list —
 * and none of it is the rule. `validateAnswers` on the server is, which is why this file has no
 * validation in it at all: a second set of rules living in the markup is a second definition, and
 * the one a stranger can edit is not the one that should win.
 */
export function CustomFields({
  fields,
  was,
}: {
  fields: readonly CustomField[];
  was: Record<string, string>;
}) {
  return (
    <>
      {fields.map((field) => {
        const name = fieldInputName(field);
        const value = was[field.id] ?? "";

        if (field.type === "checkbox") {
          return (
            <div key={field.id}>
              <label className="flex items-start gap-2.5 text-body text-heading">
                <input
                  type="checkbox"
                  name={name}
                  required={field.required}
                  defaultChecked={value !== ""}
                  aria-label={field.label}
                  className="mt-1 size-4 shrink-0"
                />
                <span>{field.label}</span>
              </label>
              {field.help && <p className={cx(hintClass, "ml-6.5")}>{field.help}</p>}
            </div>
          );
        }

        return (
          <div key={field.id}>
            <label htmlFor={name} className={labelClass}>
              {field.label}
              {!field.required && <span className="ml-1.5 font-normal text-subtle">optional</span>}
            </label>
            {field.help && <p className={hintClass}>{field.help}</p>}

            {field.type === "select" ? (
              // Keyed on the echoed answer, and it has to be. React honors `defaultValue` on a
              // `select` at mount only, so after an action resets the form the element survives
              // with nothing selected and the applicant silently loses this one answer while every
              // other field comes back. Changing the key remounts it, which is what re-applies the
              // default. `input` and `textarea` do not need this.
              <select
                key={`${field.id}:${value}`}
                id={name}
                name={name}
                required={field.required}
                defaultValue={value}
                className={cx(inputClass, "mt-2")}
              >
                {/* An empty first option so a required select cannot be satisfied by whichever
                    choice happened to be listed first. */}
                <option value="">Choose one…</option>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === "longtext" ? (
              <textarea
                id={name}
                name={name}
                rows={3}
                required={field.required}
                maxLength={field.maxLength}
                defaultValue={value}
                className={cx(inputClass, "mt-2")}
              />
            ) : (
              <input
                id={name}
                name={name}
                type={field.type === "number" ? "number" : "text"}
                required={field.required}
                maxLength={field.type === "text" ? field.maxLength : undefined}
                defaultValue={value}
                className={cx(inputClass, field.type === "number" && "tabular", "mt-2")}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
