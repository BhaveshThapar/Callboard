CREATE TABLE "message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "message_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"message_id" uuid NOT NULL,
	"state" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_events_state_check" CHECK ("message_events"."state" in ('queued','sending','sent','failed','bounced'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comp_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"template" text NOT NULL,
	"payload" json NOT NULL,
	"dedupe_key" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_ref" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_comp_dedupe_unique" UNIQUE("comp_id","dedupe_key"),
	CONSTRAINT "messages_channel_check" CHECK ("messages"."channel" in ('email')),
	CONSTRAINT "messages_kind_check" CHECK ("messages"."kind" in ('transactional','broadcast')),
	CONSTRAINT "messages_state_check" CHECK ("messages"."state" in ('queued','sending','sent','failed','bounced')),
	CONSTRAINT "messages_attempts_check" CHECK ("messages"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "unsubscribed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_events" ADD CONSTRAINT "message_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_comp_id_comps_id_fk" FOREIGN KEY ("comp_id") REFERENCES "public"."comps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_events_terminal_unique" ON "message_events" USING btree ("message_id") WHERE "message_events"."state" in ('sent','bounced');--> statement-breakpoint
CREATE INDEX "message_events_message_idx" ON "message_events" USING btree ("message_id","seq");--> statement-breakpoint
CREATE INDEX "messages_due_idx" ON "messages" USING btree ("state","send_after");