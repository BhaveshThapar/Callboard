CREATE TABLE "deposit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "deposit_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"comp_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposit_events_state_check" CHECK ("deposit_events"."state" in ('held','refund_pending','refunded','forfeited','refund_failed'))
);
--> statement-breakpoint
ALTER TABLE "deposit_events" ADD CONSTRAINT "deposit_events_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_events" ADD CONSTRAINT "deposit_events_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_events" ADD CONSTRAINT "deposit_events_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_events_terminal_unique" ON "deposit_events" USING btree ("charge_id") WHERE "deposit_events"."state" in ('refunded','forfeited');