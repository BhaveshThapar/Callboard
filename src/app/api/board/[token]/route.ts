import { NextResponse } from "next/server";
import { resolveBoardActor } from "@/lib/auth/scope";
import { boardSnapshot } from "@/lib/comp/board";

export const dynamic = "force-dynamic";

/** Polled by the live board every couple of seconds. Websockets would be a demo the demo doesn't need. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const actor = await resolveBoardActor(token);
  if (!actor) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(await boardSnapshot(actor), {
    headers: { "cache-control": "no-store" },
  });
}
