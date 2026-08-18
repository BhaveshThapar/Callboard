-- P3. Row-level security on the comp axis.
--
-- Every policy is keyed on one GUC, set by `src/db/scoped.ts` in the same batch as the statement it
-- guards. Four things make this real rather than decorative, and each was measured on `dev` before a
-- line of this file was written:
--
--   1. A GUC survives inside neon-http's `transaction()` and does not leak to the next request
--      (e2e/rls-spike.spec.ts, #33 -- both halves, because either alone passes vacuously).
--   2. It cannot come from the connection string. `?options=-c app.comp_id=...` reads back null.
--   3. `neondb_owner` has rolbypassrls, and so does `neon_superuser`, which every role created
--      through Neon's console inherits. The app role must be made with raw SQL and an explicit
--      NOBYPASSRLS or these policies attach correctly and deny nothing.
--   4. `nullif(...)` below is what makes it fail CLOSED: with no scope set, the comparison is against
--      NULL, which is never true, so a request that forgets the prefix sees zero rows rather than
--      everything. `current_setting(..., true)` returns NULL rather than raising, and the nullif
--      guards the empty string, which would raise on the ::uuid cast.
--
-- The policies apply to PUBLIC and therefore to any role that does not bypass. The role itself is
-- NOT created here -- it needs a password, which does not belong in a migration, and it is an
-- operational act per deployment. `bun run db:rls-role` is that step, and `db:doctor` reports which
-- connection the app is actually using, because a deployment that believes it has RLS and does not
-- is worse than one that knows it has none.
--
-- **Not covered, deliberately:** `orgs`, `people`, `users`, `sessions` and `drive_connections`. Those
-- are org- or user-scoped and outlive any comp -- a person is one human across an org's divisions,
-- and a session is a login, not a seat at a comp. A comp-keyed policy on them would deny every
-- legitimate read. That is a second axis and it is stated here rather than left as an apparent
-- oversight in a list of 27 tables that covers 22.

ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "assignments_comp_scope" ON "assignments" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_log_comp_scope" ON "audit_log" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "board_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "board_assignments_comp_scope" ON "board_assignments" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "charges_comp_scope" ON "charges" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "deductions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deductions_comp_scope" ON "deductions" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "deposit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deposit_events_comp_scope" ON "deposit_events" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "fee_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "fee_schedules_comp_scope" ON "fee_schedules" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invitations_comp_scope" ON "invitations" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "judge_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "judge_assignments_comp_scope" ON "judge_assignments" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "judge_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "judge_notes_comp_scope" ON "judge_notes" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "memberships_comp_scope" ON "memberships" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "messages_comp_scope" ON "messages" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payments_comp_scope" ON "payments" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "rubrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "rubrics_comp_scope" ON "rubrics" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "schedule_delays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "schedule_delays_comp_scope" ON "schedule_delays" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "scores_comp_scope" ON "scores" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "tab_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tab_runs_comp_scope" ON "tab_runs" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "teams_comp_scope" ON "teams" USING (comp_id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "comps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "comps_comp_scope" ON "comps" USING (id = nullif(current_setting('app.comp_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "rubric_criteria" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "rubric_criteria_comp_scope" ON "rubric_criteria" USING (EXISTS (SELECT 1 FROM "rubrics" WHERE rubric_criteria.rubric_id = rubrics.id AND rubrics.comp_id = nullif(current_setting('app.comp_id', true), '')::uuid));--> statement-breakpoint
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payment_allocations_comp_scope" ON "payment_allocations" USING (EXISTS (SELECT 1 FROM "payments" WHERE payment_allocations.payment_id = payments.id AND payments.comp_id = nullif(current_setting('app.comp_id', true), '')::uuid));--> statement-breakpoint
ALTER TABLE "message_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "message_events_comp_scope" ON "message_events" USING (EXISTS (SELECT 1 FROM "messages" WHERE message_events.message_id = messages.id AND messages.comp_id = nullif(current_setting('app.comp_id', true), '')::uuid));
