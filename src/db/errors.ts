/**
 * The name of the constraint a failed write violated, or null if it failed for any other reason.
 *
 * The `constraint` lives on the *cause*, not on what is thrown: drizzle wraps the driver error, and
 * its own `message` is the failed SQL. Show that message to a person and they are handed
 * `Failed query: insert into "teams" ...` — on the board screen at the moment placements go final,
 * or, worse, on the public registration form, where the person reading it is a stranger.
 *
 * So the constraint name is the only part of a database error that is ever safe to branch on, and
 * this is the one place that digs it out. Two callers read it and mean opposite things by it:
 * `lockAction` treats `tab_runs_root_unique` as a *refusal* — somebody else locked first, and there
 * must not be a second root — while `apply` treats `teams_comp_bid_code_unique` as a *retry*, because
 * the applicant did nothing wrong and the next bid code is always free. Same mechanism, opposite
 * remedy; what they share is that neither may guess from the message text.
 */
export const violatedConstraint = (error: unknown): string | null => {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ("constraint" in e && typeof e.constraint === "string") return e.constraint;
  }
  return null;
};
