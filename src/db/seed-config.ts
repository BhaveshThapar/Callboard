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
  ].map((team, i) => ({ ...team, division: "fusion", rosterSize: 16, performanceOrder: i + 1 })),
  judges: [
    { name: "Priya Raghavan", email: "priya@example.com" },
    { name: "Arjun Mehta", email: "arjun@example.com" },
    { name: "Sonia Desai", email: "sonia@example.com" },
  ],
  // Two, not one. A board link is revocable only by another board member (`refuseRevoke`), so a
  // one-person board is a board that cannot demonstrate — or use — the thing that kills a leaked link.
  board: [
    { name: "Ananya Krishnan", email: "ananya@example.com" },
    { name: "Rohit Iyer", email: "rohit@example.com" },
  ],
};
