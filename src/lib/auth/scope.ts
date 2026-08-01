import { and, eq, isNull, inArray, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  boardAssignments,
  charges,
  comps,
  judgeAssignments,
  paymentAllocations,
  people,
  SCOREABLE_STATUSES,
  teams,
} from "@/db/schema";
import type { CustomAnswer, CustomField, TeamStatus } from "@/db/schema";
import type { ChargeLineView, TeamBalance } from "@/lib/money/balance";
import { teamBalance } from "@/lib/money/balance";
import type { JudgeLabelView } from "./labels";
import { judgeLabel } from "./labels";
import { hashToken } from "./token";

/** `personId` is not optional: an unattributed lock is the thing PRD B6 forbids. */
export type BoardActor = {
  kind: "board";
  compId: string;
  compName: string;
  personId: string;
  personName: string;
  boardAssignmentId: string;
};
export type JudgeActor = {
  kind: "judge";
  compId: string;
  compName: string;
  personId: string;
  judgeName: string;
  judgeAssignmentId: string;
};
export type Actor = BoardActor | JudgeActor;

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
   * Answers to the questions this comp added to its own form. Keyed by field id, so the labels to
   * display them under come from `comps.registration` — a board that asked a question is the only
   * thing that can say what it was.
   */
  customAnswers: Record<string, CustomAnswer> | null;
  rooms: number | null;
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
  const [roster, live, allocated] = await Promise.all([
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
        customAnswers: teams.customAnswers,
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
        dueAt: charges.dueAt,
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
  ]);

  // `sum()` comes back as a string on a bigint-shaped aggregate, and Number() on it is the one place
  // cents could leave integer space. It cannot here -- an allocation is an integer and so is a sum of
  // them -- but the conversion is done once, in one place, rather than at each call site.
  const paidByCharge = new Map(allocated.map((row) => [row.chargeId, Number(row.paidCents ?? 0)]));

  const chargesByTeam = new Map<string, ChargeLineView[]>();
  for (const charge of live) {
    const lines = chargesByTeam.get(charge.teamId) ?? [];
    lines.push({
      id: charge.id,
      kind: charge.kind,
      amountCents: charge.amountCents,
      dueAt: charge.dueAt,
      paidCents: paidByCharge.get(charge.id) ?? 0,
    });
    chargesByTeam.set(charge.teamId, lines);
  }

  return roster.map((team) => {
    const lines = chargesByTeam.get(team.id) ?? [];
    return { ...team, charges: lines, balance: teamBalance(lines) };
  });
};

export const resolveRosterTeamForBoard = async (
  actor: BoardActor,
  teamId: string,
): Promise<RosterTeamView | null> => claimed(await listRosterForBoard(actor), teamId);

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
