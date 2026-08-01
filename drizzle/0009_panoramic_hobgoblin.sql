CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"due_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_reason" text,
	CONSTRAINT "charges_kind_check" CHECK ("charges"."kind" in ('registration','hotel','deposit','late_fee')),
	CONSTRAINT "charges_amount_check" CHECK ("charges"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "fee_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"per_dancer_cents" integer DEFAULT 0 NOT NULL,
	"per_room_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"late_fee_cents" integer DEFAULT 0 NOT NULL,
	"late_after" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_schedules_cents_check" CHECK ("fee_schedules"."per_dancer_cents" >= 0 and "fee_schedules"."per_room_cents" >= 0 and "fee_schedules"."deposit_cents" >= 0 and "fee_schedules"."late_fee_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "payment_allocations_amount_check" CHECK ("payment_allocations"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"rail" text NOT NULL,
	"gross_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"net_cents" integer NOT NULL,
	"allocated_cents" integer DEFAULT 0 NOT NULL,
	"external_ref" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconciled_at" timestamp with time zone,
	"recorded_by_person_id" uuid,
	CONSTRAINT "payments_rail_check" CHECK ("payments"."rail" in ('card','ach','venmo','zelle','check','cash')),
	CONSTRAINT "payments_gross_check" CHECK ("payments"."gross_cents" > 0 and "payments"."fee_cents" >= 0),
	CONSTRAINT "payments_net_identity_check" CHECK ("payments"."net_cents" = "payments"."gross_cents" - "payments"."fee_cents"),
	CONSTRAINT "payments_allocated_check" CHECK ("payments"."allocated_cents" >= 0 and "payments"."allocated_cents" <= "payments"."gross_cents")
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "rooms" integer;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_person_id_people_id_fk" FOREIGN KEY ("recorded_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "charges_live_kind_unique" ON "charges" USING btree ("team_id","kind") WHERE "charges"."voided_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_schedules_comp_unique" ON "fee_schedules" USING btree ("comp_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_live_unique" ON "payment_allocations" USING btree ("payment_id","charge_id") WHERE "payment_allocations"."voided_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_external_ref_unique" ON "payments" USING btree ("comp_id","external_ref") WHERE "payments"."external_ref" is not null;