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

/**
 * Who comes off the waitlist next: the lowest `waitlist_rank`, and an unranked team never jumps a
 * ranked one. A board that never ranked its waitlist still gets a deterministic answer -- ties and
 * nulls break by id, so a promotion is reproducible rather than dependent on row order, which
 * Postgres does not promise.
 */
export type WaitlistEntry = { id: string; waitlistRank: number | null };

export const nextOffWaitlist = (waitlisted: readonly WaitlistEntry[]): string | null => {
  const ordered = [...waitlisted].sort((a, b) => {
    if (a.waitlistRank === b.waitlistRank) return a.id < b.id ? -1 : 1;
    if (a.waitlistRank === null) return 1;
    if (b.waitlistRank === null) return -1;
    return a.waitlistRank - b.waitlistRank;
  });

  return ordered[0]?.id ?? null;
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
