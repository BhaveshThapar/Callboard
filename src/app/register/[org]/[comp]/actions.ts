"use server";

import { collectAnswers } from "@/lib/comp/fields";
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
    rooms: String(formData.get("rooms") ?? ""),
    auditionUrl: String(formData.get("auditionUrl") ?? ""),
    waiverAccepted: formData.get("waiver") === "on",
    // Collected by prefix rather than from the comp's field list, which is not known yet — so a
    // refusal that happens *before* the comp resolves still hands back what the applicant typed.
    custom: collectAnswers(formData.entries()),
  };

  const open = await openRegistration(orgSlug, compSlug);
  if (!open) {
    return { status: "error", message: "Registration for this comp is not open.", values };
  }

  /**
   * `apply` returns a typed refusal for everything it can foresee, including the bid-code race it
   * retries. This catch is for everything else — a dropped connection, a check constraint nobody
   * predicted — and it exists because of who is standing here: an applicant, on the one page with no
   * `Actor`, whose form React will blank the moment this action returns. An uncaught throw hands a
   * stranger a Next.js error boundary and loses everything they typed; a thrown *database* error
   * hands them `Failed query: insert into "teams" ...`, since drizzle's message is the failed SQL.
   *
   * So: the values go back, and the schema does not.
   */
  try {
    const result = await apply(open, {
      teamName: values.teamName,
      school: values.school || null,
      contactName: values.contactName,
      contactEmail: values.contactEmail,
      rosterSize: Number(values.rosterSize),
      // Blank is *not yet known*, and `Number("")` is 0 — which would be a stated zero, a team
      // telling the comp it needs no rooms. The two must not collapse.
      rooms: values.rooms.trim() === "" ? null : Number(values.rooms),
      auditionUrl: values.auditionUrl || null,
      waiverAccepted: values.waiverAccepted,
      custom: values.custom,
    });

    if (!result.ok) return { status: "error", message: result.message, values };
    return { status: "applied", bidCode: result.bidCode };
  } catch {
    return {
      status: "error",
      message: "Something went wrong filing your application. Please try again.",
      values,
    };
  }
};
