import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { compIdBySlugs, resolveBoardAccess } from "@/lib/auth/access";
import { orgOfComp } from "@/lib/auth/accounts";
import { storeConnection } from "@/lib/drive/connections";
import { DRIVE_STATE_COOKIE, parseDriveState } from "@/lib/drive/cookies";
import { accountEmail, exchangeCode, googleConfig } from "@/lib/drive/google";
import { sameSecret } from "@/lib/drive/sealed";

export const dynamic = "force-dynamic";

/**
 * Where Google comes back to.
 *
 * Several things are checked before a token is stored, and the order is the point — the cheapest
 * refusals first, and nothing is exchanged with Google until the request is known to be one we
 * started.
 *
 * 1. **The cookie exists and parses.** Junk means the same as absent: somebody arrived without
 *    starting a flow.
 * 2. **`state` matches, compared in constant time.** This is the whole CSRF defence, and it matters
 *    more here than in the usual OAuth case. Without it an attacker completes their *own* Google
 *    flow, hands a board the resulting callback URL, and the board's org ends up connected to the
 *    attacker's Drive — and the next thing the board does is import a roster from it.
 * 3. **Board access, resolved again.** The cookie names a comp, and a cookie is a claim. This is the
 *    same `resolveBoardAccess` every screen uses, so a board member revoked mid-flow lands here with
 *    no authority and stores nothing.
 * 4. **Google's own refusal**, including a consent screen where the person unticked Drive access.
 *
 * The `code` is never logged, and the refresh token never leaves `storeConnection`, which seals it
 * before it reaches a column.
 */
export async function GET(request: NextRequest) {
  const cookie = parseDriveState(request.cookies.get(DRIVE_STATE_COOKIE)?.value);

  // Nowhere sensible to send somebody who never started a flow, and no comp to name.
  if (!cookie) return NextResponse.redirect(new URL("/app", request.url));

  const back = `/app/${cookie.org}/${cookie.comp}/roster`;
  const done = (outcome: string) => {
    const response = NextResponse.redirect(new URL(`${back}?drive=${outcome}`, request.url));
    // Spent either way. A state that outlives its flow is a state that can be replayed.
    response.cookies.delete(DRIVE_STATE_COOKIE);
    return response;
  };

  const params = request.nextUrl.searchParams;

  if (!sameSecret(params.get("state") ?? "", cookie.state)) return done("state-mismatch");

  // Somebody pressed Cancel on the consent screen. Not an error, and not worth a red screen.
  if (params.get("error")) return done("cancelled");

  const code = params.get("code") ?? "";
  if (!code) return done("cancelled");

  const compId = await compIdBySlugs(cookie.org, cookie.comp);
  if (!compId) return done("failed");

  const actor = await resolveBoardAccess(compId);
  if (!actor) return done("no-access");

  const orgId = await orgOfComp(compId);
  if (!orgId) return done("failed");

  const config = googleConfig();
  if (!config) return done("unconfigured");

  const grant = await exchangeCode(config, code);
  if (!grant.ok) return done("refused");

  const email = await accountEmail(grant.value.accessToken);
  if (!email.ok) return done("refused");

  const stored = await storeConnection(actor, orgId, {
    refreshToken: grant.value.refreshToken,
    googleEmail: email.value,
    scope: grant.value.scope,
  });
  if (!stored.ok) return done("failed");

  return done("connected");
}
