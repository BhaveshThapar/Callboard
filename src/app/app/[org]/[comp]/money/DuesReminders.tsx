"use client";

import { useActionState } from "react";
import { cardClass, cx, inputClass, primaryButtonClass } from "@/components/styles";
import { sendDuesRemindersAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import type { BoardFormScope } from "../state";
import { IDLE } from "../state";

export type DebtorOption = { id: string; name: string; bidCode: string; balance: string };

/**
 * A10, and the thing that makes the outbox a feature rather than a library.
 *
 * Two buttons rather than one per row, deliberately: the whole point of A10 is that chasing eight
 * teams is one act instead of eight, and the per-team form is the exception a board reaches for when
 * one captain says they never got it. An empty `teamId` means everybody, and the server decides who
 * that is — this component never sends a list of who to chase, because that would be a second answer
 * to a question `whoOwes` already answers.
 */
export function DuesReminders({ scope, debtors }: { scope: BoardFormScope; debtors: DebtorOption[] }) {
  const [state, formAction, pending] = useActionState(sendDuesRemindersAction, IDLE);

  return (
    <div className={cardClass} data-testid="dues-reminders">
      <h2 className="text-card font-semibold text-heading">Chase what is outstanding</h2>
      <p className="mt-1 text-caption text-muted">
        An email to each team&apos;s captain with what they owe, line by line, signed by you rather
        than by the software. Safe to click twice — a team gets one reminder a month, and the
        database is what says so.
      </p>

      <form action={formAction} className="mt-4 flex flex-wrap items-center gap-3">
        {/* No `teamId` at all: an absent one is what the action reads as "everybody who owes". */}
        <ScopeFields scope={scope} />
        <button
          type="submit"
          disabled={pending || debtors.length === 0}
          data-testid="remind-all"
          className={primaryButtonClass}
        >
          {pending ? "…" : `Remind all outstanding (${debtors.length})`}
        </button>
      </form>

      {debtors.length > 0 && (
        <form action={formAction} className="mt-3 flex flex-wrap items-center gap-3">
          <ScopeFields scope={scope} />
          <select
            name="teamId"
            aria-label="Team"
            data-testid="remind-team"
            className={cx(inputClass, "max-w-xs")}
            defaultValue={debtors[0]?.id ?? ""}
          >
            {debtors.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} ({team.bidCode}) — {team.balance}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            data-testid="remind-one"
            className="text-caption text-muted underline underline-offset-2 hover:text-primary disabled:opacity-40"
          >
            Remind just this team
          </button>
        </form>
      )}

      {state.message && (
        <p
          role="status"
          data-testid="dues-message"
          className={cx(
            "mt-3 text-caption",
            state.status === "error" ? "text-danger" : "text-muted",
          )}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
