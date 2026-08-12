/**
 * ADJ·2 — delivering what the judges wrote.
 *
 * The map has recorded this as *"notes are captured and exportable; delivering them is the unbuilt
 * half"* since B8 shipped. The artifact already existed and a board's only instrument for handing it
 * over was downloading one CSV per team and attaching each to an email by hand — which is exactly
 * the manual work the record was supposed to end, and it is also how a team ends up sent a rival's
 * notes.
 *
 * **It carries no score, and the shape is what guarantees that.** Like `toTeamFeedbackCsv`, this
 * takes `scoredBy` as a set of `judgeId:teamId` keys with no values attached, so it cannot emit a
 * raw number even by mistake: it never holds one ([ADR-0008]).
 *
 * Pure. The caller enqueues.
 *
 * [ADR-0008]: ../../../docs/decisions/0008-judge-scores-are-de-identified.md
 */
import type { RosterTeamView } from "@/lib/auth/scope";
import { noteKey } from "@/lib/export/feedback";
import { contactPersonFor } from "./contact";
import type { MessagePayloads } from "./render";

export type FeedbackRecipient = {
  teamId: string;
  teamName: string;
  personId: string;
  dedupeKey: string;
  payload: MessagePayloads["feedback.delivered"];
};

export type FeedbackSkip = { teamId: string; teamName: string; reason: "no-contact" };

export type FeedbackPlan = { send: FeedbackRecipient[]; skipped: FeedbackSkip[] };

/**
 * Keyed on the team **and the run**.
 *
 * That is the useful property rather than an implementation detail: an override supersedes the
 * locked run with a new one, so corrected feedback gets a new key and can be delivered, while
 * pressing send twice against the same run cannot reach anybody twice. A key on the team alone would
 * make a correction undeliverable — which is the one time a board most needs to send it again.
 */
export const feedbackDedupeKey = (teamId: string, runId: string): string =>
  `feedback:${teamId}:${runId}`;

export type FeedbackSnapshot = {
  /** The locked run this feedback is drawn from. */
  runId: string;
  /** From the frozen `tab_runs.results`. */
  placements: readonly { teamId: string; place: number; deductionPoints: number }[];
  /** From the frozen `tab_runs.inputs`. `teamId` → every reason recorded against it. */
  deductionReasons: ReadonlyMap<string, readonly string[]>;
  /** `judge_assignment` id → `Judge 2`, in panel order. Never a name. */
  judges: ReadonlyMap<string, string>;
  /** `judgeId:teamId` pairs that were scored. Membership only — carries no values, deliberately. */
  scoredBy: ReadonlySet<string>;
  /** Keyed `judgeId:teamId`. Read live, because notes are deliberately not in the snapshot. */
  notes: ReadonlyMap<string, string>;
};

/**
 * One message per placed team, in placement order.
 *
 * A team that is on the roster but not in the locked results gets nothing — `teams` is the roster of
 * record and the snapshot is what was announced, so a team that withdrew before the lock has no
 * placement to be told about. A team with nobody to write to is reported rather than dropped.
 */
export const planFeedbackDelivery = (
  snapshot: FeedbackSnapshot,
  roster: readonly RosterTeamView[],
  captains: ReadonlyMap<string, string>,
  context: { compName: string; boardName: string },
): FeedbackPlan => {
  const byId = new Map(roster.map((team) => [team.id, team]));
  const send: FeedbackRecipient[] = [];
  const skipped: FeedbackSkip[] = [];

  for (const placement of [...snapshot.placements].sort((a, b) => a.place - b.place)) {
    const team = byId.get(placement.teamId);
    if (!team) continue;

    const personId = contactPersonFor(team, captains);
    if (!personId) {
      skipped.push({ teamId: team.id, teamName: team.name, reason: "no-contact" });
      continue;
    }

    // Panel order, which is `judges`' insertion order (`label_seq`) — not sorted by label text,
    // which would file Judge 10 ahead of Judge 2.
    const notes: { judge: string; note: string }[] = [];
    for (const [judgeId, label] of snapshot.judges) {
      const key = noteKey(judgeId, placement.teamId);
      const note = snapshot.notes.get(key);
      if (!snapshot.scoredBy.has(key) && note === undefined) continue;
      notes.push({ judge: label, note: note ?? "" });
    }

    send.push({
      teamId: team.id,
      teamName: team.name,
      personId,
      dedupeKey: feedbackDedupeKey(team.id, snapshot.runId),
      payload: {
        teamName: team.name,
        compName: context.compName,
        place: placement.place,
        deductionPoints: placement.deductionPoints,
        deductionReasons: [...(snapshot.deductionReasons.get(placement.teamId) ?? [])],
        notes,
        boardName: context.boardName,
      },
    });
  }

  return { send, skipped };
};
