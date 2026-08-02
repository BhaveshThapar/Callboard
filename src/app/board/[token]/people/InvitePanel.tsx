"use client";

import { useActionState, useState } from "react";
import { cardClass, cx, eyebrowClass, inputClass, pillClass, primaryButtonClass } from "@/components/styles";
import type { AccountRole } from "@/db/schema";
import { inviteAction } from "../actions";
import { IDLE } from "../state";

export type InviteeRow = {
  personId: string;
  name: string;
  email: string | null;
  role: AccountRole;
  teamName: string | null;
  accepted: boolean;
  revoked: boolean;
  expired: boolean;
};

const ROLE_LABEL: Record<AccountRole, string> = {
  board: "Board",
  captain: "Captain",
  liaison: "Liaison",
};

/**
 * The screen ADR-0011 said would have to exist before anybody could be added to a comp.
 *
 * The invitation link is shown **once**, in the message, and nothing in the product can recover it —
 * only its sha256 is stored, which is ADR-0003's rule applied to a credential that is minted rather
 * than seeded. Until the comms engine can send it, a human copies it, and the screen says so rather
 * than implying an email went out.
 */
export function InvitePanel({
  token,
  invitees,
  teams,
}: {
  token: string;
  invitees: InviteeRow[];
  teams: { id: string; name: string; bidCode: string }[];
}) {
  const [state, formAction, pending] = useActionState(inviteAction, IDLE);
  const [role, setRole] = useState<AccountRole>("captain");

  return (
    <div className={cardClass} data-testid="invite-panel">
      <h2 className="text-card font-semibold text-heading">Invite somebody</h2>
      <p className="mt-1 text-caption text-muted">
        Board members, captains and liaisons sign in. Judges do not — a judge scores from the link
        the seed printed.
      </p>

      <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="token" value={token} />

        <input
          name="name"
          placeholder="Name"
          required
          aria-label="Name"
          data-testid="invite-name"
          className={inputClass}
        />
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          aria-label="Email"
          data-testid="invite-email"
          className={inputClass}
        />

        <select
          name="role"
          value={role}
          onChange={(event) => setRole(event.target.value as AccountRole)}
          aria-label="Role"
          data-testid="invite-role"
          className={inputClass}
        >
          <option value="captain">Team captain</option>
          <option value="board">Board member</option>
          <option value="liaison">Liaison</option>
        </select>

        {/* A captain is invited *for a team*, and the CHECK on `memberships` says the same thing in
            the database — so the form asks only when the answer is required, rather than asking
            always and ignoring it. */}
        <select
          name="teamId"
          disabled={role !== "captain"}
          aria-label="Team"
          data-testid="invite-team"
          className={cx(inputClass, role !== "captain" && "opacity-40")}
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name} ({team.bidCode})
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={pending}
          data-testid="invite-submit"
          className={cx(primaryButtonClass, "sm:col-span-2")}
        >
          {pending ? "…" : "Create invitation"}
        </button>
      </form>

      {state.message && (
        <p
          role="status"
          data-testid="invite-message"
          className={cx(
            "mt-3 break-all text-caption",
            state.status === "error" ? "text-danger" : "text-muted",
          )}
        >
          {state.message}
        </p>
      )}

      {invitees.length > 0 && (
        <table className="mt-5 w-full text-body">
          <thead>
            <tr className="border-b border-border-soft text-left">
              <th className={cx(eyebrowClass, "pb-2")}>Person</th>
              <th className={cx(eyebrowClass, "pb-2")}>As</th>
              <th className={cx(eyebrowClass, "pb-2")}>State</th>
            </tr>
          </thead>
          <tbody>
            {invitees.map((invitee) => (
              <tr
                key={`${invitee.personId}-${invitee.role}`}
                data-testid={`invitee-${invitee.email}`}
                data-accepted={invitee.accepted}
                className="border-b border-border-soft/60"
              >
                <td className="py-2.5 pr-3">
                  <span className="font-medium text-heading">{invitee.name}</span>
                  <span className="block text-caption text-subtle">{invitee.email}</span>
                </td>
                <td className="py-2.5 pr-3 text-muted">
                  {ROLE_LABEL[invitee.role]}
                  {invitee.teamName && (
                    <span className="block text-caption text-subtle">{invitee.teamName}</span>
                  )}
                </td>
                <td className="py-2.5">
                  <span
                    className={cx(
                      pillClass,
                      invitee.accepted
                        ? "bg-primary-light text-primary"
                        : invitee.revoked || invitee.expired
                          ? "bg-hover text-subtle"
                          : "bg-secondary-light text-secondary",
                    )}
                  >
                    {invitee.accepted
                      ? "signed in"
                      : invitee.revoked
                        ? "superseded"
                        : invitee.expired
                          ? "expired"
                          : "invited"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
