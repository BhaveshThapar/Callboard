import { NextResponse } from "next/server";
import { listRosterForBoard, resolveBoardActor } from "@/lib/auth/scope";
import { feeScheduleFor, today } from "@/lib/money/charges";
import { toWhoOwesCsv, whoOwes } from "@/lib/money/who-owes";

export const dynamic = "force-dynamic";

/**
 * The who-owes report as a file, so a treasurer can put it beside a bank statement.
 *
 * Unlike the feedback export there is no `?team=` and there must not be: this is the board's own
 * summary of its own comp, and every row is already visible to the actor requesting it. The reason
 * feedback is per-team — one careless forward sending a team its rivals' notes — does not apply to
 * a file a board writes for itself.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const actor = await resolveBoardActor(token);
  if (!actor) return new NextResponse("Not found", { status: 404 });

  const [roster, schedule] = await Promise.all([
    listRosterForBoard(actor),
    feeScheduleFor(actor.compId),
  ]);
  const report = whoOwes(roster, schedule, today());
  const slug = (value: string): string => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");

  return new NextResponse(toWhoOwesCsv(report), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug(actor.compName)}-who-owes.csv"`,
      "cache-control": "no-store",
    },
  });
}
