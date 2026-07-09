import { eq } from "drizzle-orm";
import { createToken } from "@/lib/auth/token";
import { db } from "./index";
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
 * Seeds the demo comp described in PRD §14: eight competing teams, three judges,
 * anonymized bid codes. Scores are deliberately not seeded — the point of the demo
 * is that three people score it live from their phones.
 */

export const DEMO_TEAMS = [
  { bidCode: "A-114", name: "NCSU Nazaare", school: "NC State" },
  { bidCode: "B-207", name: "BU Dheem", school: "Boston University" },
  { bidCode: "C-331", name: "NSU Veera", school: "Northeastern" },
  { bidCode: "D-402", name: "GT Ramblin' Raas", school: "Georgia Tech" },
  { bidCode: "E-518", name: "UMD Moksha", school: "Maryland" },
  { bidCode: "F-623", name: "Pitt Nrityamala", school: "Pittsburgh" },
  { bidCode: "G-745", name: "Cornell Yalla", school: "Cornell" },
  { bidCode: "H-860", name: "UVA Aayaam", school: "Virginia" },
] as const;

export const DEMO_JUDGES = [
  { name: "Priya Raghavan", email: "priya@example.com" },
  { name: "Arjun Mehta", email: "arjun@example.com" },
  { name: "Sonia Desai", email: "sonia@example.com" },
] as const;

/** The board link is per-person, so a lock and an override carry a name. */
export const DEMO_BOARD = { name: "Ananya Krishnan", email: "ananya@example.com" } as const;

export const DEMO_CRITERIA = [
  { label: "Choreography", maxPoints: 30, weightBp: 10_000, sortOrder: 0 },
  { label: "Execution", maxPoints: 30, weightBp: 10_000, sortOrder: 1 },
  { label: "Musicality", maxPoints: 20, weightBp: 10_000, sortOrder: 2 },
  { label: "Stage Presence", maxPoints: 20, weightBp: 10_000, sortOrder: 3 },
] as const;

const DEMO_ORG_SLUG = "maryland-mayuri";

export type SeededDemo = {
  compId: string;
  compName: string;
  boardName: string;
  boardToken: string;
  judges: { name: string; token: string }[];
};

export const seedDemo = async (): Promise<SeededDemo> => {
  // Deleting the org cascades to comps, and comps cascade to everything else. Scoped to the demo
  // org by slug so that reseeding is idempotent and cannot take a real org down with it.
  await db.delete(orgs).where(eq(orgs.slug, DEMO_ORG_SLUG));

  const [org] = await db
    .insert(orgs)
    .values({ name: "Maryland Mayuri", slug: DEMO_ORG_SLUG })
    .returning();
  if (!org) throw new Error("failed to seed org");

  const [comp] = await db
    .insert(comps)
    .values({
      orgId: org.id,
      name: "Mayuri 2027",
      slug: "mayuri-2027",
      compDate: "2027-02-20",
      venue: "Ritchie Coliseum",
      status: "live",
    })
    .returning();
  if (!comp) throw new Error("failed to seed comp");

  const [boardPerson] = await db
    .insert(people)
    .values({ orgId: org.id, name: DEMO_BOARD.name, email: DEMO_BOARD.email })
    .returning();
  if (!boardPerson) throw new Error("failed to seed board member");

  await db.insert(compRoles).values({ compId: comp.id, personId: boardPerson.id, role: "board" });

  const boardToken = createToken();
  await db.insert(boardAssignments).values({
    compId: comp.id,
    personId: boardPerson.id,
    tokenHash: boardToken.tokenHash,
  });

  await db.insert(teams).values(
    DEMO_TEAMS.map((team, i) => ({
      compId: comp.id,
      name: team.name,
      school: team.school,
      bidCode: team.bidCode,
      status: "competing" as const,
      performanceOrder: i + 1,
      rosterSize: 16,
      division: "fusion",
    })),
  );

  const judgePeople = await db
    .insert(people)
    .values(DEMO_JUDGES.map((judge) => ({ orgId: org.id, name: judge.name, email: judge.email })))
    .returning();

  await db.insert(compRoles).values(
    judgePeople.map((person) => ({ compId: comp.id, personId: person.id, role: "judge" as const })),
  );

  const judgeTokens = judgePeople.map((person) => ({ person, token: createToken() }));
  await db.insert(judgeAssignments).values(
    judgeTokens.map(({ person, token }) => ({
      compId: comp.id,
      personId: person.id,
      division: "fusion",
      tokenHash: token.tokenHash,
    })),
  );

  const [rubric] = await db
    .insert(rubrics)
    .values({
      compId: comp.id,
      name: "Fusion 2027",
      normalization: "zscore",
      tiebreakers: [{ kind: "head_to_head" }],
    })
    .returning();
  if (!rubric) throw new Error("failed to seed rubric");

  await db.insert(rubricCriteria).values(DEMO_CRITERIA.map((c) => ({ rubricId: rubric.id, ...c })));

  return {
    compId: comp.id,
    compName: comp.name,
    boardName: boardPerson.name,
    boardToken: boardToken.token,
    judges: judgeTokens.map(({ person, token }) => ({ name: person.name, token: token.token })),
  };
};
