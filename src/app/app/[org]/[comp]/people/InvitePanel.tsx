"use client";

import { useActionState, useState } from "react";
import {
  cardClass,
  cx,
  eyebrowClass,
  inputClass,
  pillClass,
  primaryButtonClass,
} from "@/components/styles";
import type { AccountRole, InvitableRole } from "@/db/schema";
import { INVITABLE_ROLES } from "@/db/schema";
import { inviteAction, revokeAccessAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import type { BoardFormScope } from "../state";
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
  /** A live membership. `accepted` says they once signed in; this says they still get in. */
  hasAccess: boolean;
};

const ROLE_LABEL: Record<AccountRole, string> = {
  board: "Board",
  captain: "Captain",
  liaison: "Liaison",
};

/**
 * The options come from `INVITABLE_ROLES` rather than from a list written out here, so a role
 * gaining a screen is one edit in the schema and not two that can disagree. `ROLE_LABEL` still
 * covers every `AccountRole`, because a liaison invited before this narrowed is still on the table.
 */
const INVITE_LABEL: Record<InvitableRole, string> = {
  captain: "Team captain",
  board: "Board member",
};

/**
 * The screen ADR-0011 said would have to exist before anybody could be added to a comp.
 *
 * The invitation link is shown **once**, in the message, and nothing in the product can recover it —
 * only its sha256 is stored, which is ADR-0003's rule applied to a credential that is minted rather
 * than seeded. It is now also **emailed** to the person it names — and shown here regardless,
 * because sending is opt-in on two environment variables and a board told "emailed" on a
 * deployment without them would close the tab holding the only copy. The message says which of
 * the two actually happened.
 */
export function InvitePanel({
  scope,
  invitees,
  teams,
}: {
  scope: BoardFormScope;
  invitees: InviteeRow[];
  teams: { id: string; name: string; bidCode: string }[];
}) {
  const [state, formAction, pending] = useActionState(inviteAction, IDLE);
  const [revokeState, revokeFormAction, revoking] = useActionState(revokeAccessAction, IDLE);
  const [role, setRole] = useState<InvitableRole>("captain");

  return (
    <div className={cardClass} data-testid="invite-panel">
      <h2 className="text-card font-semibold text-heading">Invite somebody</h2>
      <p className="mt-1 text-caption text-muted">
        Board members and captains sign in. Judges do not — a judge scores from the link the seed
        printed. Liaisons cannot be invited yet, because there is nothing for one to open.
      </p>

      <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-2">
        <ScopeFields scope={scope} />

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
          onChange={(event) => setRole(event.target.value as InvitableRole)}
          aria-label="Role"
          data-testid="invite-role"
          className={inputClass}
        >
          {INVITABLE_ROLES.map((invitable) => (
            <option key={invitable} value={invitable}>
              {INVITE_LABEL[invitable]}
            </option>
          ))}
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
              <th className={cx(eyebrowClass, "pb-2")}></th>
            </tr>
          </thead>
          <tbody>
            {invitees.map((invitee) => (
              <tr
                key={`${invitee.personId}-${invitee.role}`}
                data-testid={`invitee-${invitee.email}`}
                data-accepted={invitee.accepted}
                data-has-access={invitee.hasAccess}
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
                      invitee.hasAccess
                        ? "bg-primary-light text-primary"
                        : invitee.accepted || invitee.revoked || invitee.expired
                          ? "bg-hover text-subtle"
                          : "bg-secondary-light text-secondary",
                    )}
                  >
                    {/* `accepted && !hasAccess` is somebody the board took off, and it has to read
                        differently from an envelope that was merely superseded — otherwise the one
                        state a revocation produces is the one the screen cannot show. */}
                    {invitee.hasAccess
                      ? "signed in"
                      : invitee.accepted
                        ? "removed"
                        : invitee.revoked
                          ? "superseded"
                          : invitee.expired
                            ? "expired"
                            : "invited"}
                  </span>
                </td>
                <td className="py-2.5 text-right">
                  {(invitee.hasAccess ||
                    (!invitee.accepted && !invitee.revoked && !invitee.expired)) && (
                    <form action={revokeFormAction}>
                      <ScopeFields scope={scope} />
                      <input type="hidden" name="personId" value={invitee.personId} />
                      <input type="hidden" name="role" value={invitee.role} />
                      <button
                        type="submit"
                        disabled={revoking}
                        data-testid={`revoke-${invitee.email}`}
                        className="text-micro text-subtle underline underline-offset-2 transition-colors hover:text-danger disabled:opacity-40"
                      >
                        {invitee.hasAccess ? "Remove" : "Cancel"}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {revokeState.message && (
        <p
          role="status"
          data-testid="revoke-message"
          className={cx(
            "mt-3 text-caption",
            revokeState.status === "error" ? "text-danger" : "text-muted",
          )}
        >
          {revokeState.message}
        </p>
      )}
    </div>
  );
}
