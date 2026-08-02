import type { CompStatus } from "@/db/schema";

/**
 * A comp's own lifecycle, as one total map. Pure, and deliberately data rather than a chain of
 * `if`s: `src/lib/roster/transitions.ts`' shape, for its reason — the question "can this comp go
 * from here to there" has exactly one answer and one place to read it. The database half is
 * `./status.ts`, split off the way `./tab.ts` is split from `src/lib/tabulation/`, so this file can
 * be tested without a `DATABASE_URL`.
 *
 * **Forward only, and that is the whole argument.** `open` is what makes the public form writable;
 * every other status closes it. Reopening after `live` would let an application land against a comp
 * whose roster is being scored — and after `complete`, against one whose results are locked and
 * whose roster is inside a frozen snapshot. A board that closed too early gets a new comp, which is
 * the same answer ADR-0010 gives a board running two divisions.
 *
 * `complete` is terminal for `deposit_events`' reason: it is an ending, and an ending that can be
 * walked back is not one.
 */
const ALLOWED: Record<CompStatus, readonly CompStatus[]> = {
  draft: ["open"],
  open: ["live", "complete"],
  live: ["complete"],
  complete: [],
};

export const canAdvanceComp = (from: CompStatus, to: CompStatus): boolean =>
  ALLOWED[from].includes(to);

export const nextCompStatuses = (from: CompStatus): readonly CompStatus[] => ALLOWED[from];

/**
 * What each status means to the one person who has to choose between them. Written for a board
 * member on a Sunday, not for this file: `live` and `complete` both close the form, and a screen
 * that did not say so would make the choice a guess.
 */
export const COMP_STATUS_MEANING: Record<CompStatus, string> = {
  draft: "Not announced. The public page 404s and there is no form.",
  open: "Applications are open. The public form accepts them.",
  live: "Applications are closed. The comp is running.",
  complete: "Finished. Applications stay closed and placements are published once locked.",
};
