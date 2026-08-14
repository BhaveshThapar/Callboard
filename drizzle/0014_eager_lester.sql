ALTER TABLE "teams" ADD COLUMN "music_url" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "materials_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "roster_size_requested" integer;