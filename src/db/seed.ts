import { eq } from "drizzle-orm";
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
 */

export { DEMO_CONFIG } from "./seed-config";

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
  // Deleting the org cascades to comps, and comps cascade to everything else. Scoped by slug so
  // that reseeding is idempotent and cannot take a different org down with it.
  await db.delete(orgs).where(eq(orgs.slug, config.org.slug));

  const [org] = await db
    .insert(orgs)
    .values({ name: config.org.name, slug: config.org.slug })
    .returning();
  if (!org) throw new Error("failed to seed org");

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

  const boardPeople = await db
    .insert(people)
    .values(config.board.map((b) => ({ orgId: org.id, name: b.name, email: b.email ?? null })))
    .returning();

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

  const judgePeople = await db
    .insert(people)
    .values(config.judges.map((j) => ({ orgId: org.id, name: j.name, email: j.email ?? null })))
    .returning();

  await db
    .insert(compRoles)
    .values(judgePeople.map((p) => ({ compId: comp.id, personId: p.id, role: "judge" as const })));

  const judgeTokens = judgePeople.map((person, i) => ({
    person,
    token: createToken(),
    division: config.judges[i]?.division ?? null,
  }));
  await db.insert(judgeAssignments).values(
    judgeTokens.map(({ person, token, division }) => ({
      compId: comp.id,
      personId: person.id,
      division,
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
