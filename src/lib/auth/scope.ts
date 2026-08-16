import { and, eq, isNull, inArray, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  assignments,
  boardAssignments,
  charges,
  comps,
  judgeAssignments,
  paymentAllocations,
  payments,
  people,
  SCOREABLE_STATUSES,
  teams,
} from "@/db/schema";
import type { CustomAnswer, CustomField, DutyCategory, TeamStatus } from "@/db/schema";
import type { ChargeLineView, TeamBalance } from "@/lib/money/balance";
import { teamBalance } from "@/lib/money/balance";
import type { JudgeLabelView } from "./labels";
import { judgeLabel } from "./labels";
import { hashToken } from "./token";

/**
 * `personId` is not optional: an unattributed lock is the thing PRD B6 forbids.
 *
 * `boardAssignmentId` **is** optional, and its nullability is the only trace downstream that a board
 * actor has two origins ([ADR-0022](../../../docs/decisions/0022-a-link-is-exchanged-for-a-cookie.md)):
 * a link names a row in `board_assignments`, an account names a membership, and there is no
 * assignment behind the second. Nothing reads it — `revokeAccess` works from `listBoardForBoard`,
 * which selects assignments directly — so this stays a fact about provenance rather than a thing to
 * branch on. If something ever does branch on it, that is the moment to ask whether the two grants
 * have quietly become two authorities.
 */
export type BoardActor = {
  kind: "board";
  compId: string;
  compName: string;
  personId: string;
  personName: string;
  boardAssignmentId: string | null;
};
export type JudgeActor = {
  kind: "judge";
  compId: string;
  compName: string;
  personId: string;
  judgeName: string;
  judgeAssignmentId: string;
};

/**
 * A team captain, signed in ([ADR-0016](../../../docs/decisions/0016-accounts-for-people-who-stay-links-for-people-who-visit.md)).
 *
 * `teamId` is on the actor rather than resolved per request, and that is the whole security design
 * for this kind: a captain's every read is filtered by the team their *membership* names, so a
 * `teamId` arriving on one of their forms is not a claim to be checked — it is ignored. The window
 * rule says a `teamId` is resolved against the scoped read that produced the form; here the scope
 * is the actor, which is stronger, because there is no read that could return another team's row.
 */
export type TeamActor = {
  kind: "team";
  compId: string;
  compName: string;
  personId: string;
  personName: string;
  teamId: string;
};

/** A liaison, signed in. Sees their own duties and the schedule those hang off, and nothing else. */
export type LiaisonActor = {
  kind: "liaison";
  compId: string;
  compName: string;
  personId: string;
  personName: string;
};

export type Actor = BoardActor | JudgeActor | TeamActor | LiaisonActor;

/** The two kinds that arrive from a session rather than from a token in a URL. */
export type AccountActor = TeamActor | LiaisonActor;

/** Teams a judge is allowed to see. Note the absence of `name`: blindness is enforced by the type. */
export type JudgeTeamView = { id: string; bidCode: string; performanceOrder: number | null };
export type BoardTeamView = JudgeTeamView & { name: string; school: string | null };

/**
 * The board's window onto a judge's *identity*. The board recruited these people, sends them their
 * links, and chases the slow ones, so it sees the name — but only ever beside a submission count,
 * never beside a score or a note.
 */
export type BoardJudgeView = { assignmentId: string; name: string; revokedAt: Date | null };

export type BoardMemberView = {
  assignmentId: string;
  personId: string;
  name: string;
  revokedAt: Date | null;
};

/**
 * The registration window: the whole roster, statuses and all. Never shown to a judge.
 *
 * It carries what the application *said*, because accepting a team is a decision made about that
 * application: the audition link the comp may have required, the captain to reply to, and the moment
 * the waiver was accepted. Registration wrote all three from the first commit and nothing read them
 * back, which left a board approving teams on a name and a headcount.
 *
 * All four are nullable, and not only because a seeded team has no application — `contact_person_id`
 * is `on delete set null`, so a deleted person leaves a team whose captain is gone. The screen shows
 * that as a gap rather than pretending the row is malformed.
 */
export type RosterTeamView = BoardTeamView & {
  status: TeamStatus;
  waitlistRank: number | null;
  rosterSize: number | null;
  auditionUrl: string | null;
  waiverAcceptedAt: Date | null;
  contactName: string | null;
  contactEmail: string | null;
  /**
   * Who to reach, as an id rather than an address. A10 enqueues against a `person_id`, because the
   * outbox's recipient is a person the org already knows and not a string typed onto a form — and
   * because a person with no address on file is a fact the engine records (`bounced`, with a reason)
   * rather than one this window has to pre-judge.
   */
  contactPersonId: string | null;
  /**
   * Answers to the questions this comp added to its own form. Keyed by field id, so the labels to
   * display them under come from `comps.registration` — a board that asked a question is the only
   * thing that can say what it was.
   */
  customAnswers: Record<string, CustomAnswer> | null;
  rooms: number | null;
  /**
   * A4's materials half, as the board reads it. `rosterSizeRequested` is a captain's **claim** about
   * a number the board bills on -- shown beside the roster input so a board answers it by stating
   * the roster, which is the only act that can change what a team owes.
   */
  musicUrl: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  materialsSubmittedAt: Date | null;
  rosterSizeRequested: number | null;
  /**
   * Live charges only — a voided one is history, not an obligation. A3 in one line: the roster and
   * what each team owes are one record, because the split between an acceptance doc and a Venmo
   * thread is the thing that made "who has paid" unanswerable.
   */
  charges: ChargeLineView[];
  balance: TeamBalance;
};

export type { JudgeLabelView } from "./labels";

const SCOREABLE = SCOREABLE_STATUSES;

export const resolveBoardActor = async (token: string): Promise<BoardActor | null> => {
  const [row] = await db
    .select({
      assignmentId: boardAssignments.id,
      compId: comps.id,
      compName: comps.name,
      personId: people.id,
      personName: people.name,
    })
    .from(boardAssignments)
    .innerJoin(comps, eq(comps.id, boardAssignments.compId))
    .innerJoin(people, eq(people.id, boardAssignments.personId))
    .where(
      and(eq(boardAssignments.tokenHash, hashToken(token)), isNull(boardAssignments.revokedAt)),
    )
    .limit(1);

  if (!row) return null;
  return {
    kind: "board",
    compId: row.compId,
    compName: row.compName,
    personId: row.personId,
    personName: row.personName,
    boardAssignmentId: row.assignmentId,
  };
};

export const resolveJudgeActor = async (token: string): Promise<JudgeActor | null> => {
  const [row] = await db
    .select({
      assignmentId: judgeAssignments.id,
      compId: comps.id,
      compName: comps.name,
      personId: people.id,
      judgeName: people.name,
    })
    .from(judgeAssignments)
    .innerJoin(comps, eq(comps.id, judgeAssignments.compId))
    .innerJoin(people, eq(people.id, judgeAssignments.personId))
    .where(
      and(eq(judgeAssignments.tokenHash, hashToken(token)), isNull(judgeAssignments.revokedAt)),
    )
    .limit(1);

  if (!row) return null;
  return {
    kind: "judge",
    compId: row.compId,
    compName: row.compName,
    personId: row.personId,
    judgeName: row.judgeName,
    judgeAssignmentId: row.assignmentId,
  };
};

/** The judge's window onto `teams`. Never selects the team name. */
export const listTeamsForJudge = (actor: JudgeActor): Promise<JudgeTeamView[]> =>
  db
    .select({
      id: teams.id,
      bidCode: teams.bidCode,
      performanceOrder: teams.performanceOrder,
    })
    .from(teams)
    .where(and(eq(teams.compId, actor.compId), inArray(teams.status, [...SCOREABLE])))
    .orderBy(teams.performanceOrder, teams.bidCode);

/** The board's window onto the same rows. */
export const listTeamsForBoard = (actor: BoardActor): Promise<BoardTeamView[]> =>
  db
    .select({
      id: teams.id,
      bidCode: teams.bidCode,
      performanceOrder: teams.performanceOrder,
      name: teams.name,
      school: teams.school,
    })
    .from(teams)
    .where(and(eq(teams.compId, actor.compId), inArray(teams.status, [...SCOREABLE])))
    .orderBy(teams.performanceOrder, teams.bidCode);

/**
 * A `teamId` off a form is a claim, not a fact, and every table it lands in — `scores`,
 * `judge_notes`, `deductions` — holds it as a bare FK. So the database will happily accept a row
 * naming a team from another comp, or one this comp has since dropped, and nothing downstream will
 * catch it: `tabulate()` filters those rows out of the arithmetic, which means the write *succeeds*,
 * the actor is told it worked, and it silently counts for nothing.
 *
 * The claim is checked against the same scoped read that produced the form the claim arrived on.
 * That is what makes it a check and not a second definition of "scoreable" — comp scope and
 * `SCOREABLE_STATUSES` both come free from `listTeams*`'s own `where`.
 *
 * Two functions rather than one over `Actor`, because the return types are the point: a judge
 * resolves a team to a view with no `name` on it (ADR-0008), and that must stay true of the value
 * the check hands back.
 */
const claimed = <T extends { id: string }>(scoreable: T[], teamId: string): T | null =>
  scoreable.find((team) => team.id === teamId) ?? null;

/** The refusal, in one place, so all four write paths say the same thing. */
export const NOT_COMPETING = "That team is not competing in this comp.";

export const resolveTeamForJudge = async (
  actor: JudgeActor,
  teamId: string,
): Promise<JudgeTeamView | null> => claimed(await listTeamsForJudge(actor), teamId);

export const resolveTeamForBoard = async (
  actor: BoardActor,
  teamId: string,
): Promise<BoardTeamView | null> => claimed(await listTeamsForBoard(actor), teamId);

/**
 * Every judge of the board's comp, revoked ones included — the caller decides what to do with them.
 * For the roster sidebar only: pairing this with a score or a note is what `listJudgeLabelsForBoard`
 * exists to prevent.
 */
export const listJudgesForBoard = (actor: BoardActor): Promise<BoardJudgeView[]> =>
  db
    .select({
      assignmentId: judgeAssignments.id,
      name: people.name,
      revokedAt: judgeAssignments.revokedAt,
    })
    .from(judgeAssignments)
    .innerJoin(people, eq(people.id, judgeAssignments.personId))
    .where(eq(judgeAssignments.compId, actor.compId))
    .orderBy(people.name);

/**
 * The board's window onto the **whole** roster, every status included — what registration manages.
 *
 * Deliberately not `listTeamsForBoard`, which filters to `SCOREABLE_STATUSES` because it feeds
 * scoring. A registration screen has to show the applied, the waitlisted and the dropped; a scoring
 * screen must not. Two windows, and the `teamId` check on a form resolves against whichever one
 * produced *that* form — which is the whole rule, not a second copy of it.
 *
 * The join onto `people` is a `leftJoin`: `teams.contact_person_id` is nullable (a seeded team never
 * applied, and the FK is `on delete set null`), and an inner join would silently drop those rows from
 * the board's own roster screen — a team that exists, is scoreable, and cannot be seen.
 *
 * The captain's name and email belong to a `BoardActor` and to no one else. ADR-0008 de-identifies a
 * *judge beside a score*; it says nothing about a board seeing the person who filed an application,
 * and `JudgeTeamView` is a different type for exactly this reason.
 */
export const listRosterForBoard = async (actor: BoardActor): Promise<RosterTeamView[]> => {
  const [roster, live, allocated, paid] = await Promise.all([
    db
      .select({
        id: teams.id,
        bidCode: teams.bidCode,
        performanceOrder: teams.performanceOrder,
        name: teams.name,
        school: teams.school,
        status: teams.status,
        waitlistRank: teams.waitlistRank,
        rosterSize: teams.rosterSize,
        rooms: teams.rooms,
        auditionUrl: teams.auditionUrl,
        waiverAcceptedAt: teams.waiverAcceptedAt,
        contactName: people.name,
        contactEmail: people.email,
        contactPersonId: teams.contactPersonId,
        customAnswers: teams.customAnswers,
        musicUrl: teams.musicUrl,
        emergencyContactName: teams.emergencyContactName,
        emergencyContactPhone: teams.emergencyContactPhone,
        materialsSubmittedAt: teams.materialsSubmittedAt,
        rosterSizeRequested: teams.rosterSizeRequested,
      })
      .from(teams)
      .leftJoin(people, eq(people.id, teams.contactPersonId))
      .where(eq(teams.compId, actor.compId))
      .orderBy(teams.status, teams.waitlistRank, teams.name),

    db
      .select({
        id: charges.id,
        teamId: charges.teamId,
        kind: charges.kind,
        amountCents: charges.amountCents,
      })
      .from(charges)
      .where(and(eq(charges.compId, actor.compId), isNull(charges.voidedAt)))
      .orderBy(charges.kind),

    // Grouped here rather than folded in JS, because one row per charge is the smallest thing that
    // answers "how much of this obligation is settled" and the alternative ships every allocation.
    db
      .select({ chargeId: paymentAllocations.chargeId, paidCents: sum(paymentAllocations.amountCents) })
      .from(paymentAllocations)
      .innerJoin(charges, eq(charges.id, paymentAllocations.chargeId))
      .where(and(eq(charges.compId, actor.compId), isNull(paymentAllocations.voidedAt)))
      .groupBy(paymentAllocations.chargeId),

    // A team's balance is driven by every cent that arrived, not by what is allocated to its *live*
    // charges. Deriving it from allocations loses the money behind any charge later voided, which
    // bills a reinstated team twice for what it has already paid. See `teamBalance`.
    //
    // **Minus what went back out.** `gross - refunded` is the one definition of *what this team has
    // actually paid us*, and it is a subtraction rather than a negative row because negative gross
    // would make the allocation ceiling uninterpretable (ADR-0014, ADR-0015). Before `refunded_cents`
    // a returned deposit left this sum untouched, so the org's books overstated its cash by every
    // refund it had ever made and the team still read settled.
    db
      .select({
        teamId: payments.teamId,
        paidCents: sum(sql`${payments.grossCents} - ${payments.refundedCents}`),
      })
      .from(payments)
      .where(eq(payments.compId, actor.compId))
      .groupBy(payments.teamId),
  ]);

  // `sum()` comes back as a string on a bigint-shaped aggregate, and Number() on it is the one place
  // cents could leave integer space. It cannot here -- an allocation is an integer and so is a sum of
  // them -- but the conversion is done once, in one place, rather than at each call site.
  const paidByCharge = new Map(allocated.map((row) => [row.chargeId, Number(row.paidCents ?? 0)]));
  const paidByTeam = new Map(paid.map((row) => [row.teamId, Number(row.paidCents ?? 0)]));

  const chargesByTeam = new Map<string, ChargeLineView[]>();
  for (const charge of live) {
    const lines = chargesByTeam.get(charge.teamId) ?? [];
    lines.push({
      id: charge.id,
      kind: charge.kind,
      amountCents: charge.amountCents,
      paidCents: paidByCharge.get(charge.id) ?? 0,
    });
    chargesByTeam.set(charge.teamId, lines);
  }

  return roster.map((team) => {
    const lines = chargesByTeam.get(team.id) ?? [];
    return { ...team, charges: lines, balance: teamBalance(lines, paidByTeam.get(team.id) ?? 0) };
  });
};

export const resolveRosterTeamForBoard = async (
  actor: BoardActor,
  teamId: string,
): Promise<RosterTeamView | null> => claimed(await listRosterForBoard(actor), teamId);

/**
 * What a captain may see: their own team, and no other.
 *
 * **This is a fourth window, and CLAUDE.md forbids adding one casually rather than at all.** The bar
 * is a genuinely new question, and this is one: the three existing windows all answer *which teams
 * count for this board or this judge*, and none of them can answer *what does my team owe* without
 * being handed a `teamId` to trust. This one takes the `teamId` off the **actor**, where it came
 * from a membership row rather than from a form — so unlike the other three there is no claim to
 * check, because there is no read here that could return somebody else's team.
 *
 * The projection is the scope, as it is for `publicComp`: `TeamOwnView` carries no other team, no
 * bid code but its own, and no score. Widening it is a compile error rather than a review.
 */
export type TeamOwnView = {
  id: string;
  name: string;
  bidCode: string;
  school: string | null;
  status: TeamStatus;
  rosterSize: number | null;
  rooms: number | null;
  performanceOrder: number | null;
  /**
   * What this team has filed, so the form comes back filled in rather than blank -- a captain
   * re-opening it must see what the board already holds, not be invited to retype it from memory.
   * Still their own team and no other: these are columns on the row `actor.teamId` already names.
   */
  musicUrl: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  materialsSubmittedAt: Date | null;
  rosterSizeRequested: number | null;
  charges: ChargeLineView[];
  balance: TeamBalance;
};

export const ownTeamForCaptain = async (actor: TeamActor): Promise<TeamOwnView | null> => {
  const [team, charged, paid] = await Promise.all([
    db
      .select({
        id: teams.id,
        name: teams.name,
        bidCode: teams.bidCode,
        school: teams.school,
        status: teams.status,
        rosterSize: teams.rosterSize,
        rooms: teams.rooms,
        performanceOrder: teams.performanceOrder,
        musicUrl: teams.musicUrl,
        emergencyContactName: teams.emergencyContactName,
        emergencyContactPhone: teams.emergencyContactPhone,
        materialsSubmittedAt: teams.materialsSubmittedAt,
        rosterSizeRequested: teams.rosterSizeRequested,
      })
      .from(teams)
      // Both halves: the actor's team *and* the actor's comp. A membership cannot outlive the comp
      // it names, but reading as if it could is what keeps this a scoped read rather than a lookup.
      .where(and(eq(teams.id, actor.teamId), eq(teams.compId, actor.compId)))
      .limit(1),

    db
      .select({
        id: charges.id,
        kind: charges.kind,
        amountCents: charges.amountCents,
      })
      .from(charges)
      .where(and(eq(charges.teamId, actor.teamId), isNull(charges.voidedAt)))
      .orderBy(charges.kind),

    db
      .select({
        chargeId: paymentAllocations.chargeId,
        paidCents: sum(paymentAllocations.amountCents),
      })
      .from(paymentAllocations)
      .innerJoin(charges, eq(charges.id, paymentAllocations.chargeId))
      .where(and(eq(charges.teamId, actor.teamId), isNull(paymentAllocations.voidedAt)))
      .groupBy(paymentAllocations.chargeId),
  ]);

  const row = team[0];
  if (!row) return null;

  const paidByCharge = new Map(paid.map((p) => [p.chargeId, Number(p.paidCents ?? 0)]));
  const lines: ChargeLineView[] = charged.map((charge) => ({
    ...charge,
    paidCents: paidByCharge.get(charge.id) ?? 0,
  }));

  const [totals] = await db
    .select({ paidCents: sum(sql`${payments.grossCents} - ${payments.refundedCents}`) })
    .from(payments)
    .where(and(eq(payments.teamId, actor.teamId), eq(payments.compId, actor.compId)));

  return { ...row, charges: lines, balance: teamBalance(lines, Number(totals?.paidCents ?? 0)) };
};

/**
 * The questions this comp added to its own form, so the board can read the answers under the words
 * it asked them in. `custom_answers` is keyed by field id and the ids are deliberately not the
 * labels — a board may reword a question at any time without orphaning what has already been filed
 * — so the labels have to be fetched, and this is the only thing that has them.
 *
 * Not a team window and not a claim check: it resolves no `teamId` and reads no team. It is the
 * comp's own configuration, scoped to the comp the actor holds a link for.
 */
export const listRegistrationFieldsForBoard = async (
  actor: BoardActor,
): Promise<CustomField[]> => {
  const [row] = await db
    .select({ registration: comps.registration })
    .from(comps)
    .where(eq(comps.id, actor.compId))
    .limit(1);

  return row?.registration?.fields ?? [];
};

/**
 * The board's own members and the state of their links. Named, unlike the judge projection beside a
 * score: the board sends these links and chases the people holding them, so the name is the point.
 */
export const listBoardForBoard = (actor: BoardActor): Promise<BoardMemberView[]> =>
  db
    .select({
      assignmentId: boardAssignments.id,
      personId: boardAssignments.personId,
      name: people.name,
      revokedAt: boardAssignments.revokedAt,
    })
    .from(boardAssignments)
    .innerJoin(people, eq(people.id, boardAssignments.personId))
    .where(eq(boardAssignments.compId, actor.compId))
    .orderBy(people.name);

/**
 * The same judges, de-identified. Revoked ones included: their scores still counted, so they still
 * need a label in the export. `people` is not joined at all — the name is not dropped downstream,
 * it is never read.
 */
export const listJudgeLabelsForBoard = async (actor: BoardActor): Promise<JudgeLabelView[]> => {
  const rows = await db
    .select({ assignmentId: judgeAssignments.id, labelSeq: judgeAssignments.labelSeq })
    .from(judgeAssignments)
    .where(eq(judgeAssignments.compId, actor.compId))
    .orderBy(judgeAssignments.labelSeq);

  return rows.map((row) => ({ assignmentId: row.assignmentId, label: judgeLabel(row.labelSeq) }));
};

/**
 * What one duty looks like to the person doing it.
 *
 * **What it does not carry is the point.** No other person's duty, no roster, no money, no score,
 * and no `bid_code` — a liaison holding the name-to-code mapping would end blind judging for that
 * comp from inside the product, which is what `TeamOwnView` refuses for a captain and what ADR-0008
 * spends a decision on. `teamName` is present only for a duty whose own `category` is `team`, and it
 * is that duty's team: a liaison walking NCSU Nazaare has to be told which team they are walking.
 * Widening this is a compile error rather than a review somebody has to pass.
 */
export type DutyView = {
  id: string;
  dutyId: string;
  category: DutyCategory;
  teamName: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  note: string | null;
  swaTrainedAt: Date | null;
  acknowledgedAt: Date | null;
  completedAt: Date | null;
};

/**
 * **The fifth window, and it is argued rather than assumed.**
 *
 * The rule was never *never add one* — it is *do not add one casually*, and the bar is a genuinely
 * new question. The first three answer *which teams count for this judge*, *…for this board while
 * scoring*, and *…for this board while running registration*. The fourth answers *what does my team
 * owe*. **None of them can answer *what am I supposed to be doing, and when*** — its subject is not
 * a team at all, and no widening of a team read produces it.
 *
 * An earlier draft of this argued that it was *not* a window, because scope comes off the actor and
 * no id arrives from a form. That does not survive its own precedent: `ownTeamForCaptain` takes no
 * id either and is counted as the fourth. **Taking no id is what makes a window safe, not what keeps
 * it uncounted** — and once a liaison can acknowledge a duty, an `assignmentId` genuinely does
 * arrive on a form.
 *
 * What makes it safe is the same pair as the fourth's. Scope is `actor.personId`, which came off a
 * `memberships` row rather than a form, so there is no read here that could return somebody else's
 * duty. And the write path's `assignmentId` resolves one level down *this* read — `releaseAllocation`
 * through `listPaymentsForBoard`'s shape — where the array holds only live, unrevoked rows, so an
 * already-revoked duty is refused by the same `find` that refuses another person's.
 */
export const listDutiesForLiaison = async (actor: LiaisonActor): Promise<DutyView[]> => {
  const rows = await db
    .select({
      id: assignments.id,
      dutyId: assignments.dutyId,
      category: assignments.category,
      teamName: teams.name,
      startsAt: assignments.startsAt,
      endsAt: assignments.endsAt,
      note: assignments.note,
      swaTrainedAt: assignments.swaTrainedAt,
      acknowledgedAt: assignments.acknowledgedAt,
      completedAt: assignments.completedAt,
    })
    .from(assignments)
    .leftJoin(teams, eq(teams.id, assignments.teamId))
    // Both halves, exactly as `ownTeamForCaptain` reads both: this person *and* this comp. A
    // membership cannot outlive the comp it names, but reading as if it could is what keeps this a
    // scoped read rather than a lookup.
    .where(
      and(
        eq(assignments.compId, actor.compId),
        eq(assignments.personId, actor.personId),
        isNull(assignments.revokedAt),
      ),
    )
    .orderBy(assignments.startsAt, assignments.dutyId);

  return rows;
};

/** A liaison's `assignmentId` is a claim, resolved against the read that produced the form. */
export const resolveDutyForLiaison = async (
  actor: LiaisonActor,
  assignmentId: string,
): Promise<DutyView | null> =>
  (await listDutiesForLiaison(actor)).find((d) => d.id === assignmentId) ?? null;
