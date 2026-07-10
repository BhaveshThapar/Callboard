import { NextResponse } from "next/server";
import { listJudgesForBoard, listTeamsForBoard, resolveBoardActor } from "@/lib/auth/scope";
import { notesForBoard } from "@/lib/comp/feedback";
import { latestLockedRun } from "@/lib/comp/tab";
import { toFeedbackCsv } from "@/lib/export/feedback";

export const dynamic = "force-dynamic";

/**
 * PRD B8, the per-team feedback export. Every scored number comes from the frozen `tab_runs`
 * snapshot, never from a fresh computation, so the file a team receives is the file the placements
 * were announced from. Only the notes are read live: they are deliberately not in the snapshot.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const actor = await resolveBoardActor(token);
  if (!actor) return new NextResponse("Not found", { status: 404 });

  const locked = await latestLockedRun(actor.compId);
  if (!locked) {
    return new NextResponse("Results are not locked yet.", { status: 409 });
  }

  const [teams, roster, notes] = await Promise.all([
    listTeamsForBoard(actor),
    // Revoked judges included: their scores still counted, so their feedback still ships.
    listJudgesForBoard(actor),
    notesForBoard(actor),
  ]);

  const csv = toFeedbackCsv({
    placements: locked.results.placements,
    criteria: locked.config.criteria,
    scores: locked.inputs.scores,
    teams: new Map(teams.map((t) => [t.id, { name: t.name, bidCode: t.bidCode }])),
    judges: new Map(roster.map((j) => [j.assignmentId, j.name])),
    notes,
  });

  const filename = `${actor.compName.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-feedback.csv`;

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
