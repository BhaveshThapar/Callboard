import { NextResponse } from "next/server";
import { compIdBySlugs, resolveBoardAccess } from "@/lib/auth/access";
import { DRIVE_STATE_COOKIE, DRIVE_STATE_COOKIE_OPTIONS } from "@/lib/drive/cookies";
import { newOAuthState } from "@/lib/drive/connections";
import { authUrl, googleConfig } from "@/lib/drive/google";
import { sealingConfigured } from "@/lib/drive/sealed";

export const dynamic = "force-dynamic";

/**
 * Starts A11's connect flow. A route handler for the door's reason: it sets a cookie and redirects,
 * and Next 15 forbids a Server Component doing the first.
 *
 * **Authority is proved here, before Google is ever involved.** The org and comp arrive as slugs and
 * are resolved to a comp the caller must already hold board access to -- so a stranger cannot start
 * a flow that would end with a token stored against somebody else's org. The callback proves it
 * again rather than trusting what this wrote, because a cookie is a claim.
 *
 * The `state` is 32 random bytes in an HttpOnly cookie and in the URL Google will echo back; the
 * callback compares them in constant time. Without it, an attacker who completes their own Google
 * flow can hand a board a callback URL that attaches *the attacker's* Drive to the board's org --
 * which is the ordinary OAuth CSRF, and it matters more than usual here because the thing attached
 * is a data source the board will then import a roster from.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const org = url.searchParams.get("org") ?? "";
  const comp = url.searchParams.get("comp") ?? "";

  const compId = org && comp ? await compIdBySlugs(org, comp) : null;
  if (!compId) return NextResponse.redirect(new URL("/app", request.url));

  const actor = await resolveBoardAccess(compId);
  if (!actor) return NextResponse.redirect(new URL("/app", request.url));

  const back = `/app/${org}/${comp}/roster`;

  const config = googleConfig();
  if (!config || !sealingConfigured()) {
    // Configuration is a deployment fact, not a user error, so it is said on the screen they came
    // from rather than by sending somebody to a Google page that will not work.
    return NextResponse.redirect(new URL(`${back}?drive=unconfigured`, request.url));
  }

  const state = newOAuthState();
  const response = NextResponse.redirect(authUrl(config, state));
  response.cookies.set(
    DRIVE_STATE_COOKIE,
    JSON.stringify({ state, org, comp }),
    DRIVE_STATE_COOKIE_OPTIONS,
  );
  return response;
}
