CREATE TABLE "board_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_assignments_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "comps" DROP CONSTRAINT "comps_board_token_hash_unique";--> statement-breakpoint
ALTER TABLE "board_assignments" ADD CONSTRAINT "board_assignments_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_assignments" ADD CONSTRAINT "board_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comps" DROP COLUMN "board_token_hash";