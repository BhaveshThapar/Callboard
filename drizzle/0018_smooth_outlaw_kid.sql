-- G1. Two teams cannot hold the same slot in the running order.
--
-- `DEFERRABLE INITIALLY DEFERRED` is hand-written here because drizzle cannot express it, and it is
-- load-bearing rather than decorative: moving one act up the running order is a *trade*, two teams
-- exchanging positions in a single UPDATE. A non-deferred unique is checked as each row is written,
-- so that statement transiently holds two teams at position 4 and Postgres rejects it. Probed on the
-- `dev` branch before this was written -- the partial unique index this started as failed on the
-- first swap with `duplicate key value violates unique constraint`, and this passes it while still
-- refusing a genuine duplicate.
--
-- `db` has no transactions (ADR-0012), so every statement is its own implicit transaction and the
-- deferred check lands at the end of the one UPDATE. That is what keeps a reorder a single statement
-- and keeps the sanctioned `withTransaction` callers at four.
--
-- Not partial, and it does not need to be: NULL means *not drawn yet*, Postgres treats NULLs as
-- distinct, so the whole undrawn roster coexists. Also probed, because "for free" is worth ten
-- seconds of checking.
ALTER TABLE "teams" ADD CONSTRAINT "teams_comp_performance_order_unique"
  UNIQUE ("comp_id", "performance_order") DEFERRABLE INITIALLY DEFERRED;
