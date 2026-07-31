import { config } from "dotenv";
import { isProtectedDatabase, protectedComputeId } from "../src/db/protected";

/**
 * Every spec reseeds, and seeding deletes the demo comp and everything cascading from it.
 * Resolve DATABASE_URL exactly as `src/db/seed-cli.ts` does — a leading environment variable
 * wins over `.env.local` — so this refuses on precisely the strings the seeder would use.
 */
const globalSetup = (): void => {
  config({ path: ".env.local", quiet: true });

  if (!isProtectedDatabase(process.env.DATABASE_URL)) return;

  throw new Error(
    [
      "",
      `Refusing to run e2e against Neon compute ${protectedComputeId()}.`,
      "",
      "That is the deployed demo, and every spec here reseeds — which deletes the demo comp",
      "and everything cascading from it. A prospect's judges would lose their links mid-call.",
      "",
      "Point DATABASE_URL at the `ci` or `dev` branch. docs/DEMO.md has the table.",
      "",
    ].join("\n"),
  );
};

export default globalSetup;
