import { NextResponse } from "next/server";
import { listJudgeLabelsForBoard, listTeamsForBoard, resolveBoardActor } from "@/lib/auth/scope";
import { notesForBoard } from "@/lib/comp/feedback";
import { latestLockedRun } from "@/lib/comp/tab";
import { noteKey, toTeamFeedbackCsv } from "@/lib/export/feedback";

export const dynamic = "force-dynamic";

/**
 * PRD B8, the per-team feedback export: the file the board forwards to one team. It carries that
 * team's placement, its deduction and the reason recorded against it, and what each judge wrote --
 * under `Judge 1` / `Judge 2`, and with no scores at all.
 *
 * `?team=` is required rather than optional. The unfiltered version of this route handed the board
 * a single file containing every team's feedback, which is one careless forward away from sending
 * a team its rivals' notes.
 *
 * The placement and the deduction come from the frozen `tab_runs` snapshot, so the file a team
 * receives is the file the placements were announced from. Only the notes are read live: they are
 * deliberately not in the snapshot, and are refused after the lock, so both are fixed at once.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const actor = await resolveBoardActor(token);
  if (!actor) return new NextResponse("Not found", { status: 404 });

  const bidCode = new URL(request.url).searchParams.get("team");
  if (!bidCode) {
    return new NextResponse(
      "Name the team this file is for, by bid code: /feedback?team=A-114. There is no whole-comp feedback file, because forwarding one sends every team its rivals' notes.",
      { status: 400 },
    );
  }

  const locked = await latestLockedRun(actor.compId);
  if (!locked) {
    return new NextResponse("Results are not locked yet.", { status: 409 });
  }

  const [teams, judges, notes] = await Promise.all([
    listTeamsForBoard(actor),
    // Revoked judges included: their scores still counted, so their feedback still ships.
    listJudgeLabelsForBoard(actor),
    notesForBoard(actor),
  ]);

  const team = teams.find((t) => t.bidCode === bidCode);
  if (!team) return new NextResponse("No such team in this comp.", { status: 404 });

  const deductionReasons = new Map<string, string[]>();
  for (const deduction of locked.inputs.deductions) {
    const reasons = deductionReasons.get(deduction.teamId) ?? [];
    reasons.push(deduction.reason);
    deductionReasons.set(deduction.teamId, reasons);
  }

  const csv = toTeamFeedbackCsv({
    placements: locked.results.placements.filter((p) => p.teamId === team.id),
    deductionReasons,
    teams: new Map([[team.id, { name: team.name, bidCode: team.bidCode }]]),
    judges: new Map(judges.map((j) => [j.assignmentId, j.label])),
    scoredBy: new Set(locked.inputs.scores.map((s) => noteKey(s.judgeId, s.teamId))),
    notes,
  });

  const slug = (value: string): string => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
  const filename = `${slug(actor.compName)}-${slug(team.bidCode)}-feedback.csv`;

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
