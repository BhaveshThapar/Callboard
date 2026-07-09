ALTER TABLE "tab_runs" ALTER COLUMN "inputs" SET DATA TYPE json;--> statement-breakpoint
ALTER TABLE "tab_runs" ALTER COLUMN "config" SET DATA TYPE json;--> statement-breakpoint
ALTER TABLE "tab_runs" ALTER COLUMN "results" SET DATA TYPE json;--> statement-breakpoint
ALTER TABLE "comps" ADD COLUMN "board_token_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "comps" ADD CONSTRAINT "comps_board_token_hash_unique" UNIQUE("board_token_hash");