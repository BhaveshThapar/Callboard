"use server";

import { apply, openRegistration } from "@/lib/comp/registration";
import type { ApplicationValues, ApplyState } from "./state";

/**
 * The one write in the product with no `Actor` behind it.
 *
 * So the comp is resolved from the slugs on the form and re-checked here, not trusted from the
 * render: `openRegistration` returns null unless the comp is `open` and has a form, which makes a
 * closed comp's application unwritable even if someone kept the page open past the deadline, or
 * posted to it directly. The page's own check is a courtesy; this one is the rule.
 */
export const applyAction = async (
  _previous: ApplyState,
  formData: FormData,
): Promise<ApplyState> => {
  const orgSlug = String(formData.get("org") ?? "");
  const compSlug = String(formData.get("comp") ?? "");

  const values: ApplicationValues = {
    teamName: String(formData.get("teamName") ?? ""),
    school: String(formData.get("school") ?? ""),
    contactName: String(formData.get("contactName") ?? ""),
    contactEmail: String(formData.get("contactEmail") ?? ""),
    rosterSize: String(formData.get("rosterSize") ?? ""),
    auditionUrl: String(formData.get("auditionUrl") ?? ""),
    waiverAccepted: formData.get("waiver") === "on",
  };

  const open = await openRegistration(orgSlug, compSlug);
  if (!open) {
    return { status: "error", message: "Registration for this comp is not open.", values };
  }

  const result = await apply(open, {
    teamName: values.teamName,
    school: values.school || null,
    contactName: values.contactName,
    contactEmail: values.contactEmail,
    rosterSize: Number(values.rosterSize),
    auditionUrl: values.auditionUrl || null,
    waiverAccepted: values.waiverAccepted,
  });

  if (!result.ok) return { status: "error", message: result.message, values };
  return { status: "applied", bidCode: result.bidCode };
};
