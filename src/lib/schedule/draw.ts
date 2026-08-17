/**
 * G1 — the Friday-night draw, as arithmetic.
 *
 * Callboard **ingests** the show-order result the mixer game produces; it does not run the game
 * (`docs/ROADMAP.md`, the tarpit's one exception). So there is no randomness here and could not be:
 * this directory is fenced against `Math.random()`, and the draw itself happens in a room.
 *
 * `docs/DATA_MODEL.md` designed a `show_order` table as `comp_id, team_id, position`. That is
 * `teams.performance_order` with extra steps, and it is **not built** — see ADR-0023. The column
 * already existed, was already read by the judge window's ordering, and had no write path anywhere in
 * the product; two columns both claiming to be the running order is the drift this codebase keeps
 * recording, so the draw got the writer the column never had rather than a second definition.
 */
import type { ShowOrderEntry } from "./types";

/** A team eligible to be drawn, and where it currently sits. */
export type DrawCandidate = {
  teamId: string;
  /** Null means it has never been drawn. */
  position: number | null;
  /** Only used to break the tie below, never to decide who is in the draw. */
  bidCode: string;
};

export type PositionRewrite = {
  teamId: string;
  position: number;
};

/**
 * Sorts drawn-before-undrawn, then by position, then by bid code.
 *
 * The last clause is what stops the order being whatever Postgres felt like returning. `bidCode` is
 * unique per comp (`teams_comp_bid_code_unique`), so the ordering is total — and total matters more
 * than it looks: `redraw` below assigns 1..N off this sort, so a non-deterministic tiebreak would
 * hand two teams different slots on two runs against identical data.
 */
const byCurrentOrder = (a: DrawCandidate, b: DrawCandidate): number => {
  if (a.position === null && b.position === null) return a.bidCode.localeCompare(b.bidCode);
  if (a.position === null) return 1;
  if (b.position === null) return -1;
  return a.position - b.position || a.bidCode.localeCompare(b.bidCode);
};

/**
 * Numbers the whole draw `1..N`, in the order given.
 *
 * This is the *bulk* act — a board typing in what the draw produced, or closing the holes a drop left
 * behind. It renumbers everybody on purpose, which is the opposite of `move` below, and it is why
 * duplicate positions are not something the write path has to defend against: the set it writes is
 * `1..N` by construction, so `teams_comp_performance_order_unique` can only fire on a race with
 * another board member rather than on arithmetic.
 *
 * `order` is the caller's stated sequence of team ids. Ids it does not recognise are ignored rather
 * than refused, because the caller resolved them against `listRosterForBoard` before getting here and
 * a silent extra id means the roster moved underneath the form — which the returned length says.
 */
export const redraw = (
  candidates: readonly DrawCandidate[],
  order: readonly string[],
): PositionRewrite[] => {
  const eligible = new Set(candidates.map((c) => c.teamId));
  const seen = new Set<string>();
  const rewrites: PositionRewrite[] = [];

  for (const teamId of order) {
    if (!eligible.has(teamId) || seen.has(teamId)) continue;
    seen.add(teamId);
    rewrites.push({ teamId, position: rewrites.length + 1 });
  }

  // Anybody the board did not name keeps a slot rather than losing one, appended in the order they
  // already had. A draw that silently dropped a team from the running order is the failure this whole
  // product is sold against, and it would show up on stage rather than on a screen.
  for (const candidate of [...candidates].sort(byCurrentOrder)) {
    if (seen.has(candidate.teamId)) continue;
    seen.add(candidate.teamId);
    rewrites.push({ teamId: candidate.teamId, position: rewrites.length + 1 });
  }

  return rewrites.filter((rewrite) => {
    const current = candidates.find((c) => c.teamId === rewrite.teamId);
    return current?.position !== rewrite.position;
  });
};

/**
 * Moves one team one place up or down the running order, as a **trade** of two adjacent positions.
 *
 * `reorderWaitlist`'s shape and for its reason: a trade leaves every other team's number exactly as
 * the board last saw it. A running order is read off a printed sheet by an emcee and off a phone by
 * eight liaisons, so renumbering the whole show to move one act is how six people end up holding
 * different answers to *when do I walk*.
 *
 * Returns an empty list for a move that cannot happen — a team already at the end it is being sent
 * toward, or one that is not in the draw at all.
 */
export const move = (
  candidates: readonly DrawCandidate[],
  teamId: string,
  direction: "up" | "down",
): PositionRewrite[] => {
  const drawn = candidates.filter((c) => c.position !== null).sort(byCurrentOrder);
  const from = drawn.findIndex((c) => c.teamId === teamId);
  if (from === -1) return [];

  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= drawn.length) return [];

  const moved = drawn[from]!;
  const passed = drawn[to]!;
  // Both are non-null by the filter above; the assertions are for the compiler, not for the logic.
  return [
    { teamId: moved.teamId, position: passed.position! },
    { teamId: passed.teamId, position: moved.position! },
  ];
};

/** The draw as the engine wants it. Undrawn teams are not in the running order and are left out. */
export const showOrderFrom = (candidates: readonly DrawCandidate[]): ShowOrderEntry[] =>
  candidates
    .filter((c) => c.position !== null)
    .sort(byCurrentOrder)
    .map((c) => ({ teamId: c.teamId, position: c.position! }));
