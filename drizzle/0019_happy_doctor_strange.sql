CREATE TABLE "schedule_delays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"minutes" integer NOT NULL,
	"from_position" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_delays_position_check" CHECK ("schedule_delays"."from_position" >= 1),
	CONSTRAINT "schedule_delays_minutes_check" CHECK ("schedule_delays"."minutes" <> 0)
);
--> statement-breakpoint
ALTER TABLE "comps" ADD COLUMN "schedule" json;--> statement-breakpoint
ALTER TABLE "schedule_delays" ADD CONSTRAINT "schedule_delays_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_delays" ADD CONSTRAINT "schedule_delays_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_delays_comp_seq_unique" ON "schedule_delays" USING btree ("comp_id","seq");--> statement-breakpoint
CREATE INDEX "schedule_delays_comp_idx" ON "schedule_delays" USING btree ("comp_id","seq");