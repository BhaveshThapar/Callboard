import { and, count, eq, isNull } from "drizzle-orm";
import { createToken } from "@/lib/auth/token";
import type { Tiebreaker } from "@/lib/tabulation/types";
import type { CompConfig } from "./config";
import { db } from "./index";
import { DEMO_CONFIG } from "./seed-config";
import {
  boardAssignments,
  comps,
  compRoles,
  judgeAssignments,
  orgs,
  people,
  rubricCriteria,
  rubrics,
  teams,
} from "./schema";

/**
 * Seeds a comp from a config. `seedDemo()` is this function applied to `DEMO_CONFIG`. Scores are
 * deliberately not seeded -- the point of the demo is that three people score it live from phones.
 *
 * The unit a seed replaces is the **comp**, not the org. A comp is one division (ADR-0010), so a
 * board running two of them gets two comps under one org -- and docs/INTAKE.md tells a treasurer to
 * send each division separately. Deleting by org slug would have made following that instruction
 * destroy the division seeded before it.
 */

export { DEMO_CONFIG } from "./seed-config";

/**
 * How many live board and judge links `seedFromConfig(config)` would destroy: the unrevoked links on
 * the one comp it replaces. They die silently -- the cascade takes them and the seed reissues new
 * tokens, so an old link does not error, it simply stops resolving.
 *
 * Zero means the seed *creates* rather than replaces. That distinction is the whole guard: seeding a
 * prospect's comp into the deployed demo is safe and is the documented workflow (docs/DEMO.md),
 * while reseeding one whose links are already on someone's phone is the thing that 404s mid-call.
 * Scoped to the comp rather than the org for the same reason the delete is: a sibling division's
 * links are not at risk, and counting them here would refuse the seed that creates it.
 */
export const liveLinksAtRisk = async (config: CompConfig): Promise<number> => {
  const [existing] = await db
    .select({ id: comps.id })
    .from(comps)
    .innerJoin(orgs, eq(orgs.id, comps.orgId))
    .where(and(eq(orgs.slug, config.org.slug), eq(comps.slug, config.comp.slug)));

  if (!existing) return 0;

  const [board] = await db
    .select({ n: count() })
    .from(boardAssignments)
    .where(and(eq(boardAssignments.compId, existing.id), isNull(boardAssignments.revokedAt)));

  const [judge] = await db
    .select({ n: count() })
    .from(judgeAssignments)
    .where(and(eq(judgeAssignments.compId, existing.id), isNull(judgeAssignments.revokedAt)));

  return (board?.n ?? 0) + (judge?.n ?? 0);
};

type PersonConfig = { name: string; email?: string };
type Person = typeof people.$inferSelect;

/**
 * `orgs` persists across years and across an org's divisions -- it is the institutional memory a
 * board cannot otherwise hand off, and a seed is not entitled to delete it.
 */
const findOrCreateOrg = async (config: CompConfig): Promise<typeof orgs.$inferSelect> => {
  const [existing] = await db.select().from(orgs).where(eq(orgs.slug, config.org.slug));
  if (existing) {
    if (existing.name !== config.org.name) {
      await db.update(orgs).set({ name: config.org.name }).where(eq(orgs.id, existing.id));
    }
    return { ...existing, name: config.org.name };
  }

  const [created] = await db
    .insert(orgs)
    .values({ name: config.org.name, slug: config.org.slug })
    .returning();
  if (!created) throw new Error("failed to seed org");
  return created;
};

/**
 * `people` hangs off the org, not the comp, so it survives the comp delete and must be reused rather
 * than re-inserted. Re-inserting is not merely untidy: `people_org_email_unique` refuses the second
 * insert outright, which would break every reseed of the demo, whose judges and board all carry
 * emails. Reuse is also the right answer on its own terms -- one human on two of an org's divisions
 * is one person holding a link per comp, which is what `board_assignments` already models.
 *
 * Matched on email where the config gives one, and on name where it does not.
 */
const findOrCreatePeople = async (
  orgId: string,
  roster: readonly PersonConfig[],
): Promise<Person[]> => {
  const existing = await db.select().from(people).where(eq(people.orgId, orgId));
  const byEmail = new Map(existing.flatMap((p) => (p.email ? [[p.email, p] as const] : [])));
  const byName = new Map(existing.map((p) => [p.name, p] as const));

  const resolved: Person[] = [];
  for (const person of roster) {
    const match = person.email ? byEmail.get(person.email) : byName.get(person.name);
    if (match) {
      resolved.push(match);
      continue;
    }

    const [created] = await db
      .insert(people)
      .values({ orgId, name: person.name, email: person.email ?? null })
      .returning();
    if (!created) throw new Error(`failed to seed person: ${person.name}`);

    // Keep the maps current, so a config naming the same person twice resolves to one row on the
    // second pass instead of tripping the unique index.
    if (created.email) byEmail.set(created.email, created);
    byName.set(created.name, created);
    resolved.push(created);
  }

  return resolved;
};

export type SeededComp = {
  compId: string;
  compName: string;
  /** The first board member, which is what the demo hands out and the e2e opens. */
  boardName: string;
  boardToken: string;
  board: { name: string; token: string }[];
  judges: { name: string; token: string }[];
};

export type SeededDemo = SeededComp;

export const seedFromConfig = async (config: CompConfig): Promise<SeededComp> => {
  const org = await findOrCreateOrg(config);

  // The comp is the unit of replacement, and everything a comp owns cascades from it: teams,
  // rubrics, both kinds of assignment, comp_roles, scores, deductions, tab_runs, audit_log. A
  // sibling comp under the same org -- the org's other division -- is untouched, which is the
  // whole point. `people` hangs off the org and survives; see `findOrCreatePeople`.
  await db.delete(comps).where(and(eq(comps.orgId, org.id), eq(comps.slug, config.comp.slug)));

  const [comp] = await db
    .insert(comps)
    .values({
      orgId: org.id,
      name: config.comp.name,
      slug: config.comp.slug,
      compDate: config.comp.compDate ?? null,
      venue: config.comp.venue ?? null,
      status: config.comp.status,
    })
    .returning();
  if (!comp) throw new Error("failed to seed comp");

  const boardPeople = await findOrCreatePeople(org.id, config.board);

  await db
    .insert(compRoles)
    .values(boardPeople.map((p) => ({ compId: comp.id, personId: p.id, role: "board" as const })));

  const boardTokens = boardPeople.map((person) => ({ person, token: createToken() }));
  await db.insert(boardAssignments).values(
    boardTokens.map(({ person, token }) => ({
      compId: comp.id,
      personId: person.id,
      tokenHash: token.tokenHash,
    })),
  );

  await db.insert(teams).values(
    config.teams.map((team) => ({
      compId: comp.id,
      name: team.name,
      school: team.school ?? null,
      bidCode: team.bidCode,
      status: "competing" as const,
      performanceOrder: team.performanceOrder ?? null,
      rosterSize: team.rosterSize ?? null,
      division: team.division ?? null,
    })),
  );

  const judgePeople = await findOrCreatePeople(org.id, config.judges);

  await db
    .insert(compRoles)
    .values(judgePeople.map((p) => ({ compId: comp.id, personId: p.id, role: "judge" as const })));

  const judgeTokens = judgePeople.map((person) => ({ person, token: createToken() }));
  await db.insert(judgeAssignments).values(
    judgeTokens.map(({ person, token }, i) => ({
      compId: comp.id,
      personId: person.id,
      labelSeq: i + 1,
      tokenHash: token.tokenHash,
    })),
  );

  const [rubric] = await db
    .insert(rubrics)
    .values({
      compId: comp.id,
      name: config.rubric.name,
      normalization: config.rubric.normalization,
      // Resolved below, once the criteria have ids.
      tiebreakers: [],
    })
    .returning();
  if (!rubric) throw new Error("failed to seed rubric");

  const criteria = await db
    .insert(rubricCriteria)
    .values(config.rubric.criteria.map((c) => ({ rubricId: rubric.id, ...c })))
    .returning();

  const idByLabel = new Map(criteria.map((c) => [c.label, c.id]));
  const tiebreakers: Tiebreaker[] = config.rubric.tiebreakers.map((t) => {
    if (t.kind !== "criterion") return { kind: t.kind };
    const criterionId = idByLabel.get(t.criterion);
    if (!criterionId) throw new Error(`tiebreaker names an unknown criterion: ${t.criterion}`);
    return { kind: "criterion", criterionId };
  });
  await db.update(rubrics).set({ tiebreakers }).where(eq(rubrics.id, rubric.id));

  const board = boardTokens.map(({ person, token }) => ({ name: person.name, token: token.token }));

  return {
    compId: comp.id,
    compName: comp.name,
    boardName: board[0]!.name,
    boardToken: board[0]!.token,
    board,
    judges: judgeTokens.map(({ person, token }) => ({ name: person.name, token: token.token })),
  };
};

export const seedDemo = (): Promise<SeededComp> => seedFromConfig(DEMO_CONFIG);
