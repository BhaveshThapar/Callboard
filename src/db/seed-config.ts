import type { CompConfig } from "./config";

/**
 * The demo comp of PRD §14: eight competing teams, three judges, anonymized bid codes.
 * Kept apart from `seed.ts` so it can be imported without opening a database connection.
 */
export const DEMO_CONFIG: CompConfig = {
  org: { name: "Maryland Mayuri", slug: "maryland-mayuri" },
  comp: {
    name: "Mayuri 2027",
    slug: "mayuri-2027",
    compDate: "2027-02-20",
    venue: "Ritchie Coliseum",
    status: "live",
  },
  rubric: {
    name: "Fusion 2027",
    normalization: "zscore",
    tiebreakers: [{ kind: "head_to_head" }],
    criteria: [
      { label: "Choreography", maxPoints: 30, weightBp: 10_000, sortOrder: 0 },
      { label: "Execution", maxPoints: 30, weightBp: 10_000, sortOrder: 1 },
      { label: "Musicality", maxPoints: 20, weightBp: 10_000, sortOrder: 2 },
      { label: "Stage Presence", maxPoints: 20, weightBp: 10_000, sortOrder: 3 },
    ],
  },
  teams: [
    { bidCode: "A-114", name: "NCSU Nazaare", school: "NC State" },
    { bidCode: "B-207", name: "BU Dheem", school: "Boston University" },
    { bidCode: "C-331", name: "NSU Veera", school: "Northeastern" },
    { bidCode: "D-402", name: "GT Ramblin' Raas", school: "Georgia Tech" },
    { bidCode: "E-518", name: "UMD Moksha", school: "Maryland" },
    { bidCode: "F-623", name: "Pitt Nrityamala", school: "Pittsburgh" },
    { bidCode: "G-745", name: "Cornell Yalla", school: "Cornell" },
    { bidCode: "H-860", name: "UVA Aayaam", school: "Virginia" },
    // Room counts are deliberately partial. The demo must show the *gap* case as well as the happy
    // one: a team whose rooms are unknown gets no hotel charge and a stated reason, rather than a
    // $0 hotel line a treasurer would read as "nothing owed".
  ].map((team, i) => ({
    ...team,
    division: "fusion",
    rosterSize: 16,
    rooms: i < 6 ? 4 : undefined,
    performanceOrder: i + 1,
  })),
  judges: [
    { name: "Priya Raghavan", email: "priya@example.com" },
    { name: "Arjun Mehta", email: "arjun@example.com" },
    { name: "Sonia Desai", email: "sonia@example.com" },
  ],
  board: [{ name: "Ananya Krishnan", email: "ananya@example.com" }],
  // Mayuri 2026's real numbers (PRD §14, INTAKE.md): $70/dancer + $140/room + a $100 deposit. Every
  // team therefore owes a different total, which is the normal case rather than the hard one.
  feeSchedule: {
    perDancerCents: 7000,
    perRoomCents: 14000,
    depositCents: 10000,
    lateFeeCents: 2500,
    lateAfter: "2027-02-01",
  },
};
