import { NextResponse } from "next/server";
import { resolveBoardActor } from "@/lib/auth/scope";
import { listPaymentsForBoard } from "@/lib/money/ledger";
import { toPaymentsCsv } from "@/lib/money/who-owes";

export const dynamic = "force-dynamic";

/**
 * What arrived, in the bank's shape: one row per payment, gross / fee / net, with the reconciliation
 * mark. The sibling of `../export`, which is one row per team — two files because a treasurer asks
 * two questions, and matching a statement against a per-team summary is the hand-unbundling this
 * product exists to remove.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const actor = await resolveBoardActor(token);
  if (!actor) return new NextResponse("Not found", { status: 404 });

  const rows = await listPaymentsForBoard(actor);
  const slug = (value: string): string => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");

  return new NextResponse(toPaymentsCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug(actor.compName)}-payments.csv"`,
      "cache-control": "no-store",
    },
  });
}
