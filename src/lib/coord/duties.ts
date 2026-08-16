import type { DutyCategory, DutyConfig } from "@/db/schema";

/**
 * The pure half of C1: everything that is a function of the comp's duty vocabulary and nothing else.
 *
 * **Deliberately not a fourth ESLint pure zone.** The two zones exist for one property —
 * *reproducibility of a number somebody is billed or ranked by* — and a label lookup has no such
 * property: getting one wrong shows the wrong word, not the wrong money. `src/lib/schedule/` earns
 * the third zone when it arrives, because a timeline replayed from a chain is that kind of claim.
 * A zone added here for symmetry would dilute what the fence means.
 */

/** What a board stated about one duty, or nothing if the comp never declared it. */
export const resolveDuty = (duties: DutyConfig[] | null, dutyId: string): DutyConfig | null =>
  duties?.find((d) => d.id === dutyId) ?? null;

/**
 * What a person reads for a duty, and what happens when the comp no longer declares it.
 *
 * A duty removed from the config after it was assigned is a real state — a board reworded its list
 * in February and the assignment from January still points at the old key. Rendering the raw
 * `duty_id` would show somebody `door_greeter` where a label belongs, which reads like a bug in the
 * product rather than a gap in the config. So the absence is *stated*, `BillingGap`'s discipline:
 * the screen says the comp no longer lists this duty, which is the true and actionable sentence.
 */
export const labelFor = (duties: DutyConfig[] | null, dutyId: string): string => {
  const duty = resolveDuty(duties, dutyId);
  return duty ? duty.label : "A duty this comp no longer lists";
};

export type AssignmentRefusal = { ok: false; message: string };
export type AssignmentIntent = {
  dutyId: string;
  category: DutyCategory;
  swaRequired: boolean;
  teamId: string | null;
};

/**
 * Whether a board's stated assignment is one the database could accept, checked here so the person
 * gets a sentence rather than a constraint name.
 *
 * `assignments_team_check` is the backstop and stays the guarantee — this is the explanation. The
 * same division of labour as the ledger's: the CHECK is what makes the bad state unrepresentable,
 * and the code above it is what makes the refusal readable.
 */
export const planAssignment = (
  duties: DutyConfig[] | null,
  dutyId: string,
  teamId: string | null,
): AssignmentRefusal | { ok: true; value: AssignmentIntent } => {
  const duty = resolveDuty(duties, dutyId);
  if (!duty) return { ok: false, message: "This comp does not list that duty." };

  // Both directions, because both are wrong in the same way: a `team` duty with no team derives a
  // timeline against no slot (G4), and a duty about nobody's team carrying one implies a claim
  // nothing reads -- `memberships`' captain rule, in the other domain.
  if (duty.category === "team" && !teamId) {
    return { ok: false, message: `"${duty.label}" is about one team. Pick the team.` };
  }
  if (duty.category !== "team" && teamId) {
    return { ok: false, message: `"${duty.label}" is not about a single team.` };
  }

  return {
    ok: true,
    value: { dutyId: duty.id, category: duty.category, swaRequired: duty.swaRequired, teamId },
  };
};
