import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { compSlugsById } from "@/lib/auth/access";
import { BOARD_LINK_COOKIE, BOARD_LINK_COOKIE_OPTIONS } from "@/lib/auth/cookies";
import { resolveBoardActor } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";

/**
 * The door a board link opens ([ADR-0022]).
 *
 * Every board screen used to live under `/board/<token>/…`, which meant the credential was in the
 * address bar of every page, in the browser history, in the referer of every outbound link and in
 * any screenshot of the demo. ADR-0003 named the fix and did not take it: *"exchange the URL token
 * for an HttpOnly cookie on first load and strip it from the address bar."* This is that, arriving
 * as a side effect of the screens moving to `/app/[org]/[comp]` rather than as a project of its own.
 *
 * **It is a route handler, not a page, and that is forced rather than chosen**: Next 15 refuses to
 * let a Server Component set a cookie, and setting one is the entire job here.
 *
 * **It mints nothing** (ADR-0011). It exchanges a credential it was handed for a shorter-lived
 * carrier of the same authority, over the same `board_assignments` row, revocable by the same
 * `revoked_at`. A killed link stops working here on the next request, and the cookie behind it
 * resolves to nothing the moment the row is dead — the cookie holds the raw token, not an identity,
 * so there is nothing in it to outlive the grant.
 *
 * **One optional catch-all covers the whole tree**, so `/board/<token>`, `/board/<token>/money` and
 * `/board/<token>/money/export` all land where they used to. That is what keeps every emailed link
 * and every line of `DEMO.md` correct without a rewrite.
 *
 * A dead token gets the 404 it always got. Saying *that link was revoked* would confirm which comp
 * it belonged to, to whoever is holding it.
 *
 * [ADR-0022]: ../../../../docs/decisions/0022-a-link-is-exchanged-for-a-cookie.md
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; rest?: string[] }> },
) {
  const { token, rest } = await params;

  const actor = await resolveBoardActor(token);
  if (!actor) notFound();

  const slugs = await compSlugsById(actor.compId);
  if (!slugs) notFound();

  const tail = rest?.length ? `/${rest.join("/")}` : "";
  const destination = new URL(
    `/app/${slugs.orgSlug}/${slugs.compSlug}${tail}${new URL(request.url).search}`,
    request.url,
  );

  const response = NextResponse.redirect(destination);
  response.cookies.set(BOARD_LINK_COOKIE, token, BOARD_LINK_COOKIE_OPTIONS);
  return response;
}
