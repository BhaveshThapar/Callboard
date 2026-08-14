"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { acceptInvitation, signIn, signOut } from "@/lib/auth/accounts";
import { sessionExpiry } from "@/lib/auth/credentials";
import {
  clearBoardLinkCookie,
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "@/lib/auth/cookies";
import type { AccountActionState } from "./state";

/** Never parsed, only stored, so a person can recognize a session on the sign-out screen. */
const userAgent = async (): Promise<string | null> =>
  (await headers()).get("user-agent")?.slice(0, 200) ?? null;

export const signInAction = async (
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> => {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email || !password) {
    return { status: "error", message: "Enter your email and your password." };
  }

  const result = await signIn(email, password, await userAgent());
  if (!result.ok) return { status: "error", message: result.message };

  await setSessionCookie(result.value.token, sessionExpiry(new Date()));
  // Only ever a path on this site: an open redirect on a login form hands an attacker a
  // callboard.app link that lands somewhere else, which is the whole trick.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
};

export const acceptInvitationAction = async (
  _previous: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> => {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!token) return { status: "error", message: "That link is missing its invitation." };
  if (password !== confirm) return { status: "error", message: "Those two passwords do not match." };

  const result = await acceptInvitation(token, password, await userAgent());
  if (!result.ok) return { status: "error", message: result.message };

  await setSessionCookie(result.value.token, sessionExpiry(new Date()));
  redirect("/");
};

export const signOutAction = async (): Promise<void> => {
  const token = await readSessionCookie();
  // The row first, then the cookie. A cleared cookie with a live row is a session still usable by
  // anyone who copied the value; a revoked row with a stale cookie resolves to nothing and is safe.
  if (token) await signOut(token);
  await clearSessionCookie();

  /**
   * **And the board-link cookie, which is the other way this browser could still be somebody.**
   *
   * Signing out cleared the session and left the link cookie standing for exactly one commit, which
   * meant *Sign out* on a browser that had also opened a board link ended with the person still
   * inside the comp — the header simply flipped from offering *Sign out* to reading *via board
   * link*. On the shared laptop at a comp, which is the setting this product is used in, that is the
   * failure: the button says out, and out is what it has to mean for every credential this browser
   * is holding.
   *
   * The **link is untouched** — still in their email, still revocable from the board screen
   * (ADR-0011). What ends is this browser's copy of it, which is the only thing *Sign out* was ever
   * entitled to end.
   */
  await clearBoardLinkCookie();

  redirect("/sign-in");
};
