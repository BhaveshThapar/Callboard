-- `label_seq` is what the board sees instead of a judge's name, beside a score: "Judge 2".
--
-- Added nullable and backfilled rather than added NOT NULL, because judge_assignments already has
-- rows: a bare `ADD COLUMN ... NOT NULL` with no default aborts the migration on any seeded comp.
--
-- The backfill numbers each comp's panel by creation order. That is arbitrary but permanent, which
-- is the property that matters -- once a board has read "Judge 2" off a sheet, Judge 2 must keep
-- meaning the same person.
ALTER TABLE "judge_assignments" ADD COLUMN "label_seq" integer;--> statement-breakpoint

UPDATE "judge_assignments" AS j
SET "label_seq" = numbered.seq
FROM (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "comp_id" ORDER BY "created_at", "id") AS seq
  FROM "judge_assignments"
) AS numbered
WHERE j."id" = numbered."id";--> statement-breakpoint

ALTER TABLE "judge_assignments" ALTER COLUMN "label_seq" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "judge_assignments" ADD CONSTRAINT "judge_assignments_comp_label_seq_unique" UNIQUE("comp_id","label_seq");--> statement-breakpoint
ALTER TABLE "judge_assignments" ADD CONSTRAINT "judge_assignments_label_seq_check" CHECK ("judge_assignments"."label_seq" > 0);
