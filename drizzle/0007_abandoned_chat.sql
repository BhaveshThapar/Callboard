ALTER TABLE "comps" ADD COLUMN "registration" json;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "contact_person_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "audition_url" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "waiver_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_contact_person_id_people_id_fk" FOREIGN KEY ("contact_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;