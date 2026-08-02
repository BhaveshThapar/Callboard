"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { acceptInvitation, signIn, signOut } from "@/lib/auth/accounts";
import { sessionExpiry } from "@/lib/auth/credentials";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
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
  redirect("/sign-in");
};
