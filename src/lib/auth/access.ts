import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ACCOUNT_ROLES, comps, orgs } from "@/db/schema";
import type { AccountRole } from "@/db/schema";
import { membershipFor, resolveSessionUser } from "./accounts";
import { readBoardLinkCookie, readSessionCookie } from "./cookies";
import type { BoardActor } from "./scope";
import { resolveBoardActor } from "./scope";

/**
 * How a request becomes an actor, kept apart from `scope.ts`, which says what an actor may *read*.
 *
 * The split is not tidiness. `scope.ts` is imported by `src/db/doctor.ts`, which runs as a CLI with
 * no request behind it — pulling `next/headers` in there would break the preflight at import time,
 * and the preflight is the instrument that proves the deployed database enforces its own invariants.
 */

/**
 * A comp's id from the slugs in its URL.
 *
 * **This is a lookup, not a window.** It takes no actor and it is not an authorization decision: it
 * returns an id, and the caller's very next act is to prove the holder may open it. Nothing here
 * reads a team, a person or a score, so the rule about not adding a fourth window is not in play —
 * but it is worth saying out loud, because a function in `lib/auth` that takes no `Actor` is exactly
 * the shape somebody would flag on review.
 *
 * `comps.slug` is unique per org rather than globally (`comps_org_slug_unique`), which is why both
 * halves are required and why the URL carries both — the same shape the public page already uses.
 */
export const compIdBySlugs = async (
  orgSlug: string,
  compSlug: string,
): Promise<string | null> => {
  const [row] = await db
    .select({ id: comps.id })
    .from(comps)
    .innerJoin(orgs, eq(orgs.id, comps.orgId))
    .where(and(eq(orgs.slug, orgSlug), eq(comps.slug, compSlug)))
    .limit(1);

  return row?.id ?? null;
};

/** The reverse of `compIdBySlugs`, for the one caller that has an id and needs a URL: the door. */
export const compSlugsById = async (
  compId: string,
): Promise<{ orgSlug: string; compSlug: string } | null> => {
  const [row] = await db
    .select({ orgSlug: orgs.slug, compSlug: comps.slug })
    .from(comps)
    .innerJoin(orgs, eq(orgs.id, comps.orgId))
    .where(eq(comps.id, compId))
    .limit(1);

  return row ?? null;
};

/**
 * A board actor, arriving one of two ways ([ADR-0022]).
 *
 * This is the only function in the product that says a `BoardActor` has two origins, and keeping it
 * to one function is the point: everything downstream — all three windows, all twenty writes, every
 * attribution in `audit_log` — takes the actor and cannot tell, and must not have to.
 *
 * **An account session wins.** It is the revocable, per-person, attributable credential and the one
 * the product is moving toward; a stale link cookie in a browser must never shadow the membership a
 * board actually granted. A board member whose membership was revoked falls through to the link, and
 * that is correct rather than a hole: revoking a membership does not revoke a link, and B10 is the
 * instrument for the second one.
 *
 * **The link path must prove the comp matches, and that line is the whole security of it.**
 * `membershipFor` is scoped by construction — it is asked for a specific `(person, comp, role)` and
 * cannot answer about another comp. A token is not: `resolveBoardActor` resolves whatever assignment
 * that token names, at whatever comp it belongs to. Without the equality check below, a board member
 * at one comp could hold their own perfectly valid cookie and read another org's roster by editing
 * the URL. `scope.test.ts` asserts it, and it is the reason this function exists rather than the two
 * resolvers being called side by side at forty-five call sites.
 *
 * [ADR-0022]: ../../../docs/decisions/0022-a-link-is-exchanged-for-a-cookie.md
 */
export const resolveBoardAccess = async (compId: string): Promise<BoardActor | null> => {
  const session = await readSessionCookie();
  if (session) {
    const user = await resolveSessionUser(session);
    if (user) {
      const membership = await membershipFor(user.personId, compId, "board");
      if (membership) {
        return {
          kind: "board",
          compId: membership.compId,
          compName: membership.compName,
          personId: user.personId,
          personName: membership.personName,
          // No assignment behind an account. The link and the membership are different grants of the
          // same authority, and only one of them is a row in `board_assignments`.
          boardAssignmentId: null,
        };
      }
    }
  }

  const link = await readBoardLinkCookie();
  if (!link) return null;

  const actor = await resolveBoardActor(link);
  if (!actor) return null;

  // The line. A link for one comp does not open another.
  if (actor.compId !== compId) return null;

  return actor;
};

/** The page-facing form: slugs in, actor out, or nothing. */
export const resolveBoardAccessBySlugs = async (
  orgSlug: string,
  compSlug: string,
): Promise<BoardActor | null> => {
  const compId = await compIdBySlugs(orgSlug, compSlug);
  return compId ? resolveBoardAccess(compId) : null;
};

/**
 * What the shell needs to know: who is looking, as what, and whether they have an account.
 *
 * Only the chrome uses this — the comp name in the header, the role badge, which nav items exist,
 * whether to offer *Sign out*. **It authorizes nothing.** Every page below still resolves its own
 * actor through its own resolver, because a layout that decided access would be a second definition
 * of who may read what, sitting above the one the windows enforce.
 *
 * Roles are checked in the order they have screens. A person who is somehow both board and captain
 * at one comp gets the board chrome, which is the one that can reach everything.
 */
export type CompAccess = {
  compId: string;
  compName: string;
  personName: string;
  role: AccountRole;
  /** Whether an account is behind this, rather than a link. Decides if *Sign out* means anything. */
  signedIn: boolean;
};

export const describeCompAccess = async (compId: string): Promise<CompAccess | null> => {
  const session = await readSessionCookie();
  const user = session ? await resolveSessionUser(session) : null;

  if (user) {
    for (const role of ACCOUNT_ROLES) {
      const membership = await membershipFor(user.personId, compId, role);
      if (membership) {
        return {
          compId: membership.compId,
          compName: membership.compName,
          personName: membership.personName,
          role,
          signedIn: true,
        };
      }
    }
  }

  const board = await resolveBoardAccess(compId);
  if (!board) return null;

  return {
    compId: board.compId,
    compName: board.compName,
    personName: board.personName,
    role: "board",
    signedIn: false,
  };
};
