import { NextResponse } from "next/server";
import { listJudgeLabelsForBoard, listTeamsForBoard} from "@/lib/auth/scope";
import { resolveBoardAccessBySlugs } from "@/lib/auth/access";
import { latestLockedRun } from "@/lib/comp/tab";
import { toScoreAuditCsv } from "@/lib/export/scores";

export const dynamic = "force-dynamic";

/**
 * The board's audit export: every judge's score on every criterion, from the frozen snapshot, under
 * `Judge 1` / `Judge 2`. This is how a board checks the arithmetic itself and spots a judge who
 * scored a team far off the other two -- without learning which of its judges that was.
 *
 * This file is for the board. The per-team file at `/feedback` is the one that gets forwarded, and
 * it carries no scores.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org: string; comp: string }> },
): Promise<Response> {
  const { org, comp } = await params;

  const actor = await resolveBoardAccessBySlugs(org, comp);
  if (!actor) return new NextResponse("Not found", { status: 404 });

  const locked = await latestLockedRun(actor.compId);
  if (!locked) {
    return new NextResponse("Results are not locked yet.", { status: 409 });
  }

  const [teams, judges] = await Promise.all([
    listTeamsForBoard(actor),
    listJudgeLabelsForBoard(actor),
  ]);

  const csv = toScoreAuditCsv({
    placements: locked.results.placements,
    criteria: locked.config.criteria,
    scores: locked.inputs.scores,
    teams: new Map(teams.map((t) => [t.id, { name: t.name, bidCode: t.bidCode }])),
    judges: new Map(judges.map((j) => [j.assignmentId, j.label])),
  });

  const filename = `${actor.compName.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-scores.csv`;

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
