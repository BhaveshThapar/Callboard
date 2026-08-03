import { NextResponse } from "next/server";
import { sweep } from "@/lib/comms/outbox";

export const dynamic = "force-dynamic";
/** Sending is a network round trip per message; the default 10s is not enough for a full sweep. */
export const maxDuration = 60;

/**
 * The tick. A scheduled workflow calls this; nothing else should be able to.
 *
 * **The outbox is the queue**, so there is no queue dependency to add and no worker to run — the
 * `messages` table is the work list and its unique index is the lock. That is the same instinct as
 * "polling, not websockets": eight teams and a handful of reminders do not justify infrastructure,
 * and a missed tick self-heals on the next one.
 *
 * Authorization is a shared secret in a header rather than an IP allowlist, because neither Vercel
 * nor GitHub's runners promise a stable egress address. Without `CRON_SECRET` set the route refuses everything: an
 * unauthenticated endpoint that sends email is a thing somebody will find, and the failure mode of
 * getting this backwards is a stranger draining a board's outbox at somebody's inbox.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron is not configured" }, { status: 503 });
  }

  const offered = request.headers.get("authorization");
  if (offered !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const result = await sweep();
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
