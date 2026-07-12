export type BoardLinkRow = { assignmentId: string; name: string; revokedAt: Date | null };

/**
 * `revoked` is a boolean, not the `Date` the row carries. `BoardSnapshot` is serialized through
 * `/api/board/[token]`, where a `Date` arrives as a string — so a `Date` here would be a type that
 * lies on the client. `JudgeProgress` narrows the same column for the same reason.
 */
export type BoardLink = {
  assignmentId: string;
  name: string;
  revoked: boolean;
  isSelf: boolean;
};

/**
 * `isSelf` keys off the *assignment*, not the person. Nothing constrains `(comp_id, person_id)` to
 * be unique on `board_assignments`, and what gets revoked is a link, not a human.
 */
export const boardLinks = (
  roster: readonly BoardLinkRow[],
  selfAssignmentId: string,
): BoardLink[] =>
  roster.map((row) => ({
    assignmentId: row.assignmentId,
    name: row.name,
    revoked: row.revokedAt !== null,
    isSelf: row.assignmentId === selfAssignmentId,
  }));

/**
 * Why a board member may not revoke this link, or `null` if nothing here refuses it.
 *
 * Refusing *self*-revoke is the whole safety guard, and it earns its place twice. It is what keeps a
 * comp administrable: to revoke you must hold a live link, and the target is never you, so there
 * were at least two live links before and there is at least one after. And it is what keeps the
 * refusal honest — nothing in the product mints a board link, so revoking your own is a one-way
 * exit even when the comp survives it.
 *
 * `null` does **not** mean the write will succeed. Two board members revoking each other at the same
 * instant both pass this and would together leave the comp with nothing that opens. Only the
 * database can refuse that, and `revokeBoardAction` is where it does.
 */
export const refuseRevoke = (
  links: readonly BoardLink[],
  targetAssignmentId: string,
): string | null => {
  if (!targetAssignmentId) return "Pick a board member.";

  // An `assignmentId` arriving on a form is a claim, not a fact: check it against the scoped read
  // that produced the form. This is also what stops a crafted id reaching Postgres as a bad uuid.
  const target = links.find((link) => link.assignmentId === targetAssignmentId);
  if (!target) return "That board link is not on this comp.";

  if (target.isSelf) {
    return (
      "You cannot revoke your own link. Nothing re-issues a board link, so you would lock " +
      "yourself out for good — ask another board member to revoke it for you."
    );
  }
  if (target.revoked) return "That board link is already revoked.";

  return null;
};
