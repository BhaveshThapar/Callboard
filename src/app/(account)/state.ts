/**
 * Split from `./actions` for the reason `board/[token]/state.ts` is split from its actions: a
 * `"use server"` file may export **only async functions**, so a constant and a type living beside
 * the actions is a build error rather than a lint one. `tsc` does not catch it; `next build` does,
 * which is why CI runs one.
 *
 * There is no `"ok"` here, unlike `BoardActionState`. A successful sign-in redirects, so the only
 * thing this state ever carries back to a form is a refusal.
 */
export type AccountActionState = { status: "idle" | "error"; message?: string };

export const ACCOUNT_IDLE: AccountActionState = { status: "idle" };
