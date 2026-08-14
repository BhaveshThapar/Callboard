import { NextResponse } from "next/server";
import { resolveBoardAccess } from "@/lib/auth/access";
import { boardSnapshot } from "@/lib/comp/board";

export const dynamic = "force-dynamic";

/**
 * Polled by the live board every couple of seconds. Websockets would be a demo the demo doesn't need.
 *
 * Keyed on the **comp id**, not on a credential, since [ADR-0022] moved the credential into a
 * cookie: the id says which comp is being asked about and `resolveBoardAccess` says whether this
 * browser may hear the answer. A forged id resolves to nothing, exactly as a forged token did — what
 * changed is that the polling URL is no longer a bearer credential being written to a server log
 * every two seconds for the length of a comp.
 *
 * [ADR-0022]: ../../../../../docs/decisions/0022-a-link-is-exchanged-for-a-cookie.md
 */
export async function GET(_request: Request, { params }: { params: Promise<{ comp: string }> }) {
  const { comp } = await params;

  const actor = await resolveBoardAccess(comp);
  if (!actor) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(await boardSnapshot(actor), {
    headers: { "cache-control": "no-store" },
  });
}
