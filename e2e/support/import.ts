import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `@/db` reads DATABASE_URL when it loads.
const { db } = await import("@/db");
const { charges, comps, orgs, people, teams } = await import("@/db/schema");
const { and, eq } = await import("drizzle-orm");
const { importTeams } = await import("@/lib/drive/import");
const { resolveBoardActor } = await import("@/lib/auth/scope");
type TeamCandidate = import("@/lib/drive/parse").TeamCandidate;

/**
 * Drives A11's **write** half from outside the product.
 *
 * `import.spec.ts` said a live handshake "cannot run here" and stopped at reachability — true of
 * `listFolder` and `previewImport`, which call Google, and **not true of `importTeams`**, which
 * takes candidates that are already parsed and touches Google not at all. So the one function in
 * A11 that actually inserts rows shipped with no test of any kind: nothing asserted that an
 * imported team lands `applied`, which the map calls load-bearing, and nothing asserted the
 * contact guard the code spends a paragraph explaining.
 *
 * Same shape as `comms.ts`: call the library directly, because the thing under test is what the
 * database ends up holding rather than what a button does.
 */
const [command, ...rest] = process.argv.slice(2);
if (!command) {
  throw new Error("usage: import.ts <run|teams|charges|person> [args]");
}

const compIdOf = async (slug: string): Promise<{ id: string; orgId: string }> => {
  const [comp] = await db
    .select({ id: comps.id, orgId: comps.orgId })
    .from(comps)
    .innerJoin(orgs, eq(orgs.id, comps.orgId))
    .where(eq(comps.slug, slug))
    .limit(1);
  if (!comp) throw new Error(`no comp ${slug}`);
  return comp;
};

const candidate = (over: Partial<TeamCandidate> & { row: number; name: string }): TeamCandidate => ({
  school: null,
  rosterSize: null,
  rooms: null,
  contactName: null,
  contactEmail: null,
  problems: [],
  ...over,
});

/**
 * Fixtures rather than CSV, because `parseRoster` already has its own unit tests and this is about
 * what happens *after* parsing. A fixture that went through the parser would be testing the parser
 * twice and the writer once.
 */
const FIXTURES: Record<string, TeamCandidate[]> = {
  /** Two ordinary rows, one carrying a captain. */
  basic: [
    candidate({
      row: 2,
      name: "Imported Alpha",
      school: "State",
      rosterSize: 18,
      rooms: 4,
      contactName: "Asha Rao",
      contactEmail: "asha@example.com",
    }),
    candidate({ row: 3, name: "Imported Beta", rosterSize: 12 }),
  ],

  /** One good row among rows the parser flagged. `isImportable` must skip, never insert. */
  problems: [
    candidate({ row: 2, name: "Imported Gamma" }),
    candidate({ row: 3, name: "", problems: [{ kind: "missing-name" }] }),
    candidate({ row: 4, name: "Imported Gamma", problems: [{ kind: "duplicate-name", of: 2 }] }),
  ],

  /**
   * The guard the code explains at length and nothing exercised: a sheet with an email column and
   * no captain column. `people` is the row an account, a membership and every message recipient
   * hang off, with no history to undo a bad write — so a nameless row must not rename the person
   * it matches to their own address.
   */
  "email-only": [
    candidate({ row: 2, name: "Imported Delta", contactEmail: "asha@example.com" }),
  ],
};

switch (command) {
  /** Runs the writer as a board member would, and reports what it claims it did. */
  case "run": {
    const [token, fixture] = rest;
    if (!token || !fixture) throw new Error("usage: import.ts run <boardToken> <fixture>");

    const candidates = FIXTURES[fixture];
    if (!candidates) throw new Error(`unknown fixture ${fixture}`);

    const actor = await resolveBoardActor(token);
    if (!actor) throw new Error("that board token resolves to nobody");

    const result = await importTeams(actor, candidates);
    console.log(
      result.ok ? `${result.value.imported} ${result.value.skipped}` : `error ${result.message}`,
    );
    break;
  }

  /** Name, status and contact per team — where the `applied` claim is either true or it is not. */
  case "teams": {
    const comp = await compIdOf(rest[0] ?? "");
    const rows = await db
      .select({ name: teams.name, status: teams.status, email: people.email })
      .from(teams)
      .leftJoin(people, eq(people.id, teams.contactPersonId))
      .where(eq(teams.compId, comp.id))
      .orderBy(teams.name);
    console.log(rows.map((r) => `${r.name} ${r.status} ${r.email ?? "-"}`).join("\n"));
    break;
  }

  /**
   * How many obligations the comp holds. Importing must create none: `applied` is not in
   * `BILLABLE_STATUSES`, so accepting a team through `setTeamStatus` stays the only act that bills.
   * An importer that inserted `accepted` rows would be a second path deciding what a team owes.
   */
  case "charges": {
    const comp = await compIdOf(rest[0] ?? "");
    const rows = await db.select({ id: charges.id }).from(charges).where(eq(charges.compId, comp.id));
    console.log(String(rows.length));
    break;
  }

  /** What `people` holds for one address, which is what the name guard is about. */
  case "person": {
    const comp = await compIdOf(rest[0] ?? "");
    const email = rest[1];
    if (!email) throw new Error("usage: import.ts person <compSlug> <email>");
    const rows = await db
      .select({ name: people.name })
      .from(people)
      .where(and(eq(people.orgId, comp.orgId), eq(people.email, email)));
    console.log(rows.length === 0 ? "none" : rows.map((r) => r.name).join("|"));
    break;
  }

  default:
    throw new Error(`unknown command: ${command}`);
}
