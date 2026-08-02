ALTER TABLE "deposit_events" DROP CONSTRAINT "deposit_events_charge_id_charges_id_fk";
--> statement-breakpoint
DROP INDEX "deposit_events_terminal_unique";--> statement-breakpoint
ALTER TABLE "deposit_events" ALTER COLUMN "charge_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deposit_events" ADD COLUMN "team_id" uuid;--> statement-breakpoint
UPDATE "deposit_events" AS e SET "team_id" = c."team_id" FROM "charges" AS c WHERE c."id" = e."charge_id";--> statement-breakpoint
ALTER TABLE "deposit_events" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deposit_events" ADD CONSTRAINT "deposit_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_events" ADD CONSTRAINT "deposit_events_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_events_terminal_unique" ON "deposit_events" USING btree ("comp_id","team_id") WHERE "deposit_events"."state" in ('refunded','forfeited');--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_check" CHECK ("payments"."refunded_cents" >= 0 and "payments"."refunded_cents" <= "payments"."gross_cents");
