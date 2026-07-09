CREATE TABLE "comp_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "comp_roles_unique" UNIQUE("comp_id","person_id","role"),
	CONSTRAINT "comp_roles_role_check" CHECK ("comp_roles"."role" in ('board','liaison','judge','captain','attendee'))
);
--> statement-breakpoint
CREATE TABLE "comps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"comp_date" date,
	"venue" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comps_org_slug_unique" UNIQUE("org_id","slug"),
	CONSTRAINT "comps_status_check" CHECK ("comps"."status" in ('draft','open','live','complete'))
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_org_email_unique" UNIQUE("org_id","email")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"name" text NOT NULL,
	"school" text,
	"bid_code" text NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"waitlist_rank" integer,
	"roster_size" integer,
	"division" text,
	"performance_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_comp_bid_code_unique" UNIQUE("comp_id","bid_code"),
	CONSTRAINT "teams_status_check" CHECK ("teams"."status" in ('applied','waitlisted','accepted','dropped','competing'))
);
--> statement-breakpoint
CREATE TABLE "rubric_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rubric_id" uuid NOT NULL,
	"label" text NOT NULL,
	"max_points" integer NOT NULL,
	"weight_bp" integer DEFAULT 10000 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rubric_criteria_max_points_check" CHECK ("rubric_criteria"."max_points" > 0),
	CONSTRAINT "rubric_criteria_weight_check" CHECK ("rubric_criteria"."weight_bp" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalization" text DEFAULT 'zscore' NOT NULL,
	"tiebreakers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubrics_normalization_check" CHECK ("rubrics"."normalization" in ('raw','zscore','rank'))
);
--> statement-breakpoint
CREATE TABLE "deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deductions_points_check" CHECK ("deductions"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "judge_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"division" text,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_assignments_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"judge_assignment_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"raw_value" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scores_judge_team_criterion_unique" UNIQUE("judge_assignment_id","team_id","criterion_id"),
	CONSTRAINT "scores_raw_value_check" CHECK ("scores"."raw_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tab_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"rubric_id" uuid NOT NULL,
	"inputs" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by_person_id" uuid,
	"supersedes_id" uuid,
	"override_reason" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_person_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_kind_check" CHECK ("audit_log"."actor_kind" in ('board','judge','system'))
);
--> statement-breakpoint
ALTER TABLE "comp_roles" ADD CONSTRAINT "comp_roles_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comp_roles" ADD CONSTRAINT "comp_roles_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comps" ADD CONSTRAINT "comps_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deductions" ADD CONSTRAINT "deductions_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deductions" ADD CONSTRAINT "deductions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deductions" ADD CONSTRAINT "deductions_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_assignments" ADD CONSTRAINT "judge_assignments_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_assignments" ADD CONSTRAINT "judge_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_judge_assignment_id_judge_assignments_id_fk" FOREIGN KEY ("judge_assignment_id") REFERENCES "public"."judge_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_criterion_id_rubric_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."rubric_criteria"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_runs" ADD CONSTRAINT "tab_runs_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_runs" ADD CONSTRAINT "tab_runs_rubric_id_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_runs" ADD CONSTRAINT "tab_runs_locked_by_person_id_people_id_fk" FOREIGN KEY ("locked_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_runs" ADD CONSTRAINT "tab_runs_supersedes_id_tab_runs_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."tab_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_comp_at_idx" ON "audit_log" USING btree ("comp_id","at");