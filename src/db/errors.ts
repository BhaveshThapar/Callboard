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

/**
 * The errors that prove a statement never reached Postgres. Nothing else belongs here.
 *
 * `ENOTFOUND` and `EAI_AGAIN` are DNS: no address was resolved, so no byte was sent. `ECONNREFUSED`
 * is a closed port: the packet was answered with a refusal rather than by a server. In all three the
 * database did not see the statement, so sending it again is a first act rather than a second one.
 *
 * **`ECONNRESET` is deliberately absent, and that is the whole design.** A reset means a connection
 * *was* established and then died, so an `insert` may have committed with the response lost on the
 * way back. Retrying that is the crash-after-send footprint ADR-0020 refuses for a message, with a
 * payment on the other end of it — and this product is sold against exactly the failure of a number
 * counted twice. A reset must surface as an error somebody reads.
 */
const NEVER_ARRIVED = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]);

/**
 * Whether a thrown request provably never reached the database.
 *
 * Same shape as `violatedConstraint` and for the same reason: Node's `fetch` throws a bare
 * `TypeError: fetch failed` and hangs the real cause underneath it, so the `code` is the only part
 * safe to branch on and this is the one place that digs it out. Branching on the message text would
 * mean "fetch failed" — a sentence that is equally true of the reset this must not retry.
 */
export const neverArrived = (error: unknown): boolean => {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ("code" in e && typeof e.code === "string" && NEVER_ARRIVED.has(e.code)) return true;
  }
  return false;
};
