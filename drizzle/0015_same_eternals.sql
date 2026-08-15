CREATE TABLE "drive_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"google_email" text NOT NULL,
	"refresh_token_sealed" text NOT NULL,
	"granted_scope" text NOT NULL,
	"connected_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "drive_connections" ADD CONSTRAINT "drive_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_connections" ADD CONSTRAINT "drive_connections_connected_by_person_id_people_id_fk" FOREIGN KEY ("connected_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_connections_live_unique" ON "drive_connections" USING btree ("org_id") WHERE "drive_connections"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "drive_connections_org_idx" ON "drive_connections" USING btree ("org_id");