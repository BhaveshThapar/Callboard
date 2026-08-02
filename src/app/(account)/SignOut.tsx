"use client";

import { signOutAction } from "./actions";

export function SignOut() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        data-testid="sign-out"
        className="text-caption text-muted underline underline-offset-2 hover:text-primary"
      >
        Sign out
      </button>
    </form>
  );
}
