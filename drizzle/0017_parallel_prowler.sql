CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"duty_id" text NOT NULL,
	"category" text NOT NULL,
	"team_id" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"note" text,
	"swa_trained_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "assignments_category_check" CHECK ("assignments"."category" in ('team','judge','hospitality','general')),
	CONSTRAINT "assignments_team_check" CHECK (("assignments"."category" = 'team') = ("assignments"."team_id" is not null)),
	CONSTRAINT "assignments_window_check" CHECK ("assignments"."ends_at" is null or ("assignments"."starts_at" is not null and "assignments"."ends_at" > "assignments"."starts_at")),
	CONSTRAINT "assignments_progress_check" CHECK ("assignments"."completed_at" is null or "assignments"."acknowledged_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "comps" ADD COLUMN "duties" json;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_live_unique" ON "assignments" USING btree ("comp_id","person_id","duty_id","team_id") WHERE revoked_at is null and team_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_live_no_team_unique" ON "assignments" USING btree ("comp_id","person_id","duty_id") WHERE revoked_at is null and team_id is null;--> statement-breakpoint
CREATE INDEX "assignments_comp_person_idx" ON "assignments" USING btree ("comp_id","person_id");