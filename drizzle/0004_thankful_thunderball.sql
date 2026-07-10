CREATE TABLE "judge_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"judge_assignment_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"note" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_notes_judge_team_unique" UNIQUE("judge_assignment_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "judge_notes" ADD CONSTRAINT "judge_notes_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_notes" ADD CONSTRAINT "judge_notes_judge_assignment_id_judge_assignments_id_fk" FOREIGN KEY ("judge_assignment_id") REFERENCES "public"."judge_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_notes" ADD CONSTRAINT "judge_notes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;