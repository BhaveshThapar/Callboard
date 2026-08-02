"use client";

import { useActionState } from "react";
import { cx, inputClass, primaryButtonClass } from "@/components/styles";
import { PASSWORD_MIN } from "@/lib/auth/credentials";
import { ACCOUNT_IDLE } from "./state";
import type { AccountActionState } from "./state";

type Action = (state: AccountActionState, formData: FormData) => Promise<AccountActionState>;

/**
 * Sign-in and accept-invitation are one component because they are one form with one field
 * different, and two copies would be two places to forget `autoComplete` — which is not cosmetic:
 * the wrong value here is what makes a password manager save a login under the wrong site, or fail
 * to offer the new password on the invitation screen.
 */
export function CredentialForm({
  action,
  mode,
  email,
  token,
  next,
  submitLabel,
}: {
  action: Action;
  mode: "sign-in" | "accept";
  email?: string;
  token?: string;
  next?: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, ACCOUNT_IDLE);
  const accepting = mode === "accept";

  return (
    <form action={formAction} className="mt-6 space-y-4" data-testid="credential-form">
      {token && <input type="hidden" name="token" value={token} />}
      {next && <input type="hidden" name="next" value={next} />}

      <div>
        <label htmlFor="email" className="text-caption font-medium text-muted">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required={!accepting}
          // On the invitation screen the address is fixed: the invitation names who it is for, so
          // letting somebody type a different one is how accepting it would make you somebody else.
          readOnly={accepting}
          defaultValue={email}
          autoComplete="username"
          data-testid="credential-email"
          className={cx(inputClass, "mt-1", accepting && "text-muted")}
        />
      </div>

      <div>
        <label htmlFor="password" className="text-caption font-medium text-muted">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={accepting ? PASSWORD_MIN : undefined}
          autoComplete={accepting ? "new-password" : "current-password"}
          data-testid="credential-password"
          className={cx(inputClass, "mt-1")}
        />
        {accepting && (
          <p className="mt-1 text-caption text-subtle">
            At least {PASSWORD_MIN} characters. A short sentence is a good one.
          </p>
        )}
      </div>

      {accepting && (
        <div>
          <label htmlFor="confirm" className="text-caption font-medium text-muted">
            Password again
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            autoComplete="new-password"
            data-testid="credential-confirm"
            className={cx(inputClass, "mt-1")}
          />
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        data-testid="credential-submit"
        className={cx(primaryButtonClass, "w-full")}
      >
        {pending ? "…" : submitLabel}
      </button>

      {state.status === "error" && (
        <p role="alert" data-testid="credential-message" className="text-caption text-danger">
          {state.message}
        </p>
      )}
    </form>
  );
}
