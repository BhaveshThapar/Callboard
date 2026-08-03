import { and, count, eq, isNull } from "drizzle-orm";
import { createToken } from "@/lib/auth/token";
import { generateCharges } from "@/lib/fees/schedule";
import type { Tiebreaker } from "@/lib/tabulation/types";
import type { CompConfig } from "./config";
import { db } from "./index";
import { DEMO_CONFIG } from "./seed-config";
import {
  BILLABLE_STATUSES,
  boardAssignments,
  charges,
  comps,
  compRoles,
  feeSchedules,
  paymentAllocations,
  payments,
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
 * Matched on email where the config gives one, and on name where it does not. The applicants that
 * registration writes live in the same table, so a captain whose team was seeded away survives here
 * too -- inert, since every read is comp-scoped and their team went with the comp.
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

type SeededTeam = { id: string; bidCode: string };

/**
 * Background payments, so a prospect opens the money screen on the three states that matter rather
 * than nine identical rows: a team settled exactly, a team part-paid, and teams that have paid
 * nothing.
 *
 * **Deliberately not PRD §14's two exhibits.** BU Dheem's $100 deposit arriving as $97.01 and
 * NCSU's $2,160 lump are what DEMO.md's money beat *performs*, live, in front of the prospect — and
 * a row the script asks the operator to type must not already be sitting there. It was, and the
 * step did not merely look redundant: allocating Dheem's deposit a second time is refused by the
 * ceiling in `recordPayment` (*"$100.00 is more than is left on that deposit charge ($0.00)"*), so
 * the beat failed mid-call. Same defect as the roster having nobody to accept, one screen over.
 *
 * These two teams are therefore chosen because **the script never touches them**. Moksha settles in
 * full; Nrityamala pays registration and deposit and leaves the hotel outstanding, which is what
 * puts a real number in the "still owed" column before anybody clicks anything.
 *
 * Written directly rather than through `recordPayment`, because that takes a `BoardActor` and a seed
 * has none. The counter is set to match the allocations in the same insert, which is the invariant
 * `db:doctor` checks — a seed that got this wrong would be reported as drift, which is the point.
 * `e2e/doctor.spec.ts`'s orphaned-allocation case needs a live allocation to exist here at all.
 */
const seedDemoPayments = async (
  compId: string,
  byBidCode: Map<string, SeededTeam & { id: string }>,
): Promise<void> => {
  /**
   * Each names the obligations it settles — `null` meaning all of them — rather than a lump to be
   * split greedily across whatever `charges` hands back. That query is unordered, so "pay $1,220
   * against this team" would land differently depending on how Postgres felt: the hotel part-paid
   * and the deposit untouched, or the reverse. A seed that varies is a seed no script can describe.
   *
   * Naming kinds also survives the late fee. From `lateAfter` there is a fourth charge, and Moksha
   * settling *everything* stays true where a hardcoded $1,780 would silently stop settling.
   */
  const background = [
    { bidCode: "E-518", rail: "ach" as const, kinds: null, ref: "demo-moksha-settled" },
    {
      bidCode: "F-623",
      rail: "venmo" as const,
      kinds: ["registration", "deposit"],
      ref: "demo-nrityamala-partial",
    },
  ];

  const live = await db
    .select({ id: charges.id, teamId: charges.teamId, kind: charges.kind, amountCents: charges.amountCents })
    .from(charges)
    .where(eq(charges.compId, compId));

  for (const { bidCode, rail, kinds, ref } of background) {
    const team = byBidCode.get(bidCode);
    if (!team) continue;

    const allocations = live
      .filter((c) => c.teamId === team.id && (kinds === null || kinds.includes(c.kind)))
      .map((c) => ({ chargeId: c.id, amountCents: c.amountCents }));
    if (allocations.length === 0) continue;

    // Gross equals the sum allocated: these arrived by bank transfer, where nothing is withheld.
    // The fee-bearing case is BU Dheem's $97.01, which the demo script types rather than seeds.
    const allocated = allocations.reduce((sum, a) => sum + a.amountCents, 0);
    const [payment] = await db
      .insert(payments)
      .values({
        compId,
        teamId: team.id,
        rail,
        grossCents: allocated,
        feeCents: 0,
        netCents: allocated,
        allocatedCents: allocated,
        externalRef: ref,
      })
      .returning({ id: payments.id });

    if (payment) {
      await db
        .insert(paymentAllocations)
        .values(allocations.map((a) => ({ paymentId: payment.id, ...a })));
    }
  }
};

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
      registration: config.registration ?? null,
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

  // Captains, resolved before the teams that point at them. Same find-or-create as the board and the
  // judges, so a captain who also sits on the board is one person and a reseed reuses them both.
  // Without this a seeded team has no `contact_person_id`, and A10 correctly refuses to chase a team
  // it has no way to reach — which made the reminder beat unrehearsable on the demo comp.
  const contactPeople = await findOrCreatePeople(
    org.id,
    config.teams.flatMap((team) => (team.contact ? [team.contact] : [])),
  );
  const contacts = new Map(contactPeople.flatMap((p) => (p.email ? [[p.email, p] as const] : [])));

  await db.insert(teams).values(
    config.teams.map((team) => ({
      compId: comp.id,
      contactPersonId: team.contact ? (contacts.get(team.contact.email)?.id ?? null) : null,
      name: team.name,
      school: team.school ?? null,
      bidCode: team.bidCode,
      // A config written for a scoring demo describes a comp that is already running, so the
      // default is `competing`. A registration config says otherwise, team by team.
      status: team.status ?? ("competing" as const),
      waitlistRank: team.waitlistRank ?? null,
      performanceOrder: team.performanceOrder ?? null,
      rosterSize: team.rosterSize ?? null,
      division: team.division ?? null,
      rooms: team.rooms ?? null,
    })),
  );

  // Comp-scoped, so the delete above already took the previous one with it (ADR-0013). Absent means
  // the comp bills nothing -- not that it bills zero, which is why there is no default row.
  if (config.feeSchedule) {
    const schedule = {
      perDancerCents: config.feeSchedule.perDancerCents,
      perRoomCents: config.feeSchedule.perRoomCents,
      depositCents: config.feeSchedule.depositCents,
      lateFeeCents: config.feeSchedule.lateFeeCents,
      lateAfter: config.feeSchedule.lateAfter ?? null,
    };
    await db.insert(feeSchedules).values({ compId: comp.id, ...schedule });

    // A seeded comp describes one already running, so its billable teams already owe what the
    // schedule says. Without this the roster screen shows a dash in every Balance cell and the
    // demo cannot show the thing it is for. Generated through the same pure engine the product
    // uses -- a seed that computed totals its own way would be a second definition of the bill.
    const seeded = await db
      .select({ id: teams.id, bidCode: teams.bidCode, status: teams.status, rosterSize: teams.rosterSize, rooms: teams.rooms })
      .from(teams)
      .where(eq(teams.compId, comp.id));

    const byBidCode = new Map(seeded.map((team) => [team.bidCode, team]));
    const billable = seeded.filter((team) =>
      (BILLABLE_STATUSES as readonly string[]).includes(team.status),
    );

    const { lines } = generateCharges({
      schedule,
      teams: billable.map((team) => ({
        teamId: team.id,
        rosterSize: team.rosterSize,
        rooms: team.rooms,
      })),
      asOf: new Date().toISOString().slice(0, 10),
    });

    if (lines.length > 0) {
      await db.insert(charges).values(
        lines.map((line) => ({
          compId: comp.id,
          teamId: line.teamId,
          kind: line.kind,
          amountCents: line.amountCents,
        })),
      );
    }

    // Two background payments, so the money screen opens on a settled team, a partly-paid team and
    // several untouched ones. PRD §14's own exhibits are deliberately *not* among them: the demo
    // script types those, and a row it asks for cannot already exist.
    await seedDemoPayments(comp.id, byBidCode);
  }

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
