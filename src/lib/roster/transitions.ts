import type { TeamStatus } from "@/db/schema";

/**
 * The roster lifecycle, as one total map. Pure, and deliberately data rather than a chain of `if`s:
 * the question "can this team go from here to there" has exactly one answer and one place to read it.
 *
 * `dropped` is not terminal. Registration churn runs from December to February -- teams drop, teams
 * come back, waitlisted teams get promoted -- and that is months before anyone scores anything. A
 * board that cannot un-drop a team it dropped by mistake would be forced to re-register them, which
 * is how a roster of record stops being the record.
 *
 * What makes that safe is not this table but `rosterIsFrozen`: once a comp has a locked run, the
 * roster is part of a frozen snapshot and nothing may move at all. Reinstating a team *after* the
 * lock is the one transition that would be genuinely dangerous -- it would hand a dropped team back
 * the scores it had already been given (ADR-0009) -- and that door is shut on the other side.
 */
const ALLOWED: Record<TeamStatus, readonly TeamStatus[]> = {
  applied: ["accepted", "waitlisted", "dropped"],
  waitlisted: ["accepted", "dropped"],
  accepted: ["competing", "dropped"],
  competing: ["dropped"],
  dropped: ["waitlisted", "accepted"],
};

export const canTransition = (from: TeamStatus, to: TeamStatus): boolean =>
  ALLOWED[from].includes(to);

export const allowedFrom = (from: TeamStatus): readonly TeamStatus[] => ALLOWED[from];

export type WaitlistEntry = { id: string; waitlistRank: number | null };

/**
 * The order of the queue, and the only definition of it. Lowest `waitlist_rank` first; an unranked
 * team never jumps a ranked one; ties and nulls break by id, so the answer is reproducible rather
 * than dependent on row order, which Postgres does not promise.
 *
 * Everything that asks a question about waitlist position sorts with this -- who comes off next,
 * and what "the team above this one" means to a board reordering the list. A second comparator
 * would be a second answer to the same question, and the two would disagree on exactly the rows
 * that matter: the tied ones and the unranked ones.
 */
const byWaitlistOrder = (a: WaitlistEntry, b: WaitlistEntry): number => {
  if (a.waitlistRank === b.waitlistRank) return a.id < b.id ? -1 : 1;
  if (a.waitlistRank === null) return 1;
  if (b.waitlistRank === null) return -1;
  return a.waitlistRank - b.waitlistRank;
};

export const nextOffWaitlist = (waitlisted: readonly WaitlistEntry[]): string | null =>
  [...waitlisted].sort(byWaitlistOrder)[0]?.id ?? null;

export type RankRewrite = { id: string; waitlistRank: number };

/**
 * Re-spacing, and the only path that renumbers anything. Walks the intended order and leaves a rank
 * alone whenever it already sorts after the one before it, so the renumbering stops as soon as the
 * existing numbers can carry the order on their own -- teams ahead of the moved pair keep their
 * places, gaps included.
 */
const respace = (target: readonly WaitlistEntry[]): RankRewrite[] => {
  const rewrites: RankRewrite[] = [];
  let previous = 0;

  for (const entry of target) {
    const rank =
      entry.waitlistRank !== null && entry.waitlistRank > previous
        ? entry.waitlistRank
        : previous + 1;

    if (rank !== entry.waitlistRank) rewrites.push({ id: entry.id, waitlistRank: rank });
    previous = rank;
  }

  return rewrites;
};

/**
 * Moves one team one place up or down its comp's waitlist, as arithmetic. Returns only the rows that
 * have to change, and an empty list for a move that cannot happen -- a team already at the end it is
 * being sent toward, or one not on the waitlist at all.
 *
 * **A reorder does not renumber.** The ordinary case is a *trade*: two adjacent teams exchange
 * ranks, which leaves the set of numbers on the comp exactly as it was. Every team outside the pair
 * keeps the number the board has already seen, including the gaps that promotions and drops left
 * behind -- and a gap is the normal state of a live waitlist, because ranks are assigned on arrival
 * and never compacted.
 *
 * Two teams cannot trade what one of them does not have, so a pair that shares a rank -- two board
 * members waitlisting in the same second, which `appendToWaitlist` deliberately tolerates -- or one
 * that has no rank at all falls through to `respace`. That is the only way a third team's number
 * moves, and it moves as little as the ordering allows.
 */
export const reorderWaitlist = (
  waitlisted: readonly WaitlistEntry[],
  teamId: string,
  direction: "up" | "down",
): RankRewrite[] => {
  const ordered = [...waitlisted].sort(byWaitlistOrder);
  const from = ordered.findIndex((t) => t.id === teamId);
  if (from === -1) return [];

  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ordered.length) return [];

  const moved = ordered[from]!;
  const passed = ordered[to]!;

  if (
    moved.waitlistRank !== null &&
    passed.waitlistRank !== null &&
    moved.waitlistRank !== passed.waitlistRank
  ) {
    return [
      { id: moved.id, waitlistRank: passed.waitlistRank },
      { id: passed.id, waitlistRank: moved.waitlistRank },
    ];
  }

  const target = [...ordered];
  target[from] = passed;
  target[to] = moved;

  return respace(target);
};

/**
 * The rank a team joining the waitlist gets: the end of the queue. Arrival order is the only order
 * a board has not had to state, and it is the one they assume is running -- "we waitlisted them in
 * the order they applied" is what a treasurer will say out loud when a slot opens.
 *
 * Unranked rows are skipped rather than counted, so a comp seeded with some ranks and some nulls
 * still appends past the highest *stated* rank instead of colliding with it.
 */
export const nextWaitlistRank = (existing: readonly (number | null)[]): number => {
  const ranked = existing.filter((r): r is number => r !== null);
  return ranked.length === 0 ? 1 : Math.max(...ranked) + 1;
};

/**
 * Dropping an `accepted` or `competing` team frees a slot, so the waitlist moves. Dropping one that
 * was only `applied` or `waitlisted` frees nothing, because it never held a slot.
 */
export const dropFreesASlot = (from: TeamStatus): boolean =>
  from === "accepted" || from === "competing";
