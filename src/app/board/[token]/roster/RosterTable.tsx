"use client";

import { useActionState } from "react";
import { cardClass, cx, eyebrowClass, pillClass } from "@/components/styles";
import type { TeamStatus } from "@/db/schema";
import type { RosterTeamView } from "@/lib/auth/scope";
import { allowedFrom } from "@/lib/roster/transitions";
import { setTeamStatusAction } from "../actions";
import { IDLE } from "../state";

const STATUS_TONE: Record<TeamStatus, string> = {
  applied: "bg-hover text-muted",
  waitlisted: "bg-secondary-light text-secondary",
  accepted: "bg-primary-light text-primary",
  competing: "bg-primary-light text-primary",
  dropped: "bg-hover text-subtle",
};

/**
 * What the team actually submitted — the evidence the accept/waitlist/drop decision is made on.
 *
 * A comp can *require* an audition link (`registration.requireAuditionUrl`), which makes a missing
 * one worth saying out loud rather than rendering as a blank cell. A seeded team never applied and
 * has neither, so "—" means "there was no application", not "the application was empty".
 */
function ApplicationCell({ team }: { team: RosterTeamView }) {
  if (!team.auditionUrl && !team.waiverAcceptedAt) {
    return <span className="text-caption text-subtle">—</span>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {team.auditionUrl ? (
        <a
          href={team.auditionUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`roster-audition-${team.bidCode}`}
          className="text-caption text-primary underline-offset-2 hover:underline"
        >
          Audition ↗
        </a>
      ) : (
        <span className="text-caption text-subtle">no audition link</span>
      )}
      {team.waiverAcceptedAt ? (
        <span
          data-testid={`roster-waiver-${team.bidCode}`}
          className="text-micro text-subtle"
          title={team.waiverAcceptedAt.toISOString()}
        >
          Waiver ✓ {team.waiverAcceptedAt.toISOString().slice(0, 10)}
        </span>
      ) : (
        <span className="text-micro text-danger">no waiver</span>
      )}
    </div>
  );
}

export function RosterTable({
  token,
  roster,
  locked,
}: {
  token: string;
  roster: RosterTeamView[];
  locked: boolean;
}) {
  const [state, formAction, pending] = useActionState(setTeamStatusAction, IDLE);

  const counts = roster.reduce<Record<string, number>>((acc, team) => {
    acc[team.status] = (acc[team.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className={cardClass}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-card font-semibold text-heading">Roster</h2>
        <p className="text-caption text-muted">
          {(["applied", "waitlisted", "accepted", "competing", "dropped"] as const)
            .filter((s) => counts[s])
            .map((s) => `${counts[s]} ${s}`)
            .join(" · ")}
        </p>
      </div>

      {locked && (
        <p role="status" className="mt-3 text-caption text-muted">
          Results are locked. The roster is part of the frozen snapshot and can no longer change.
        </p>
      )}

      <table className="mt-4 w-full text-body" data-testid="roster">
        <thead>
          <tr className="border-b border-border-soft text-left">
            <th className={cx(eyebrowClass, "pb-2")}>Team</th>
            <th className={cx(eyebrowClass, "pb-2")}>Bid</th>
            <th className={cx(eyebrowClass, "pb-2")}>Dancers</th>
            <th className={cx(eyebrowClass, "pb-2")}>Application</th>
            <th className={cx(eyebrowClass, "pb-2")}>Status</th>
            {!locked && <th className={cx(eyebrowClass, "pb-2")}>Move to</th>}
          </tr>
        </thead>
        <tbody>
          {roster.map((team) => (
            <tr
              key={team.id}
              data-testid={`roster-row-${team.bidCode}`}
              data-status={team.status}
              className="border-b border-border-soft/60"
            >
              <td className="py-2.5 pr-3">
                <span className="font-medium text-heading">{team.name}</span>
                {team.school && (
                  <span className="block text-caption text-subtle">{team.school}</span>
                )}
                {team.contactEmail && (
                  <a
                    href={`mailto:${team.contactEmail}`}
                    data-testid={`roster-contact-${team.bidCode}`}
                    className="block text-caption text-muted underline-offset-2 hover:text-primary hover:underline"
                  >
                    {team.contactName ?? team.contactEmail}
                  </a>
                )}
              </td>
              <td className="tabular py-2.5 pr-3 text-muted">{team.bidCode}</td>
              <td className="tabular py-2.5 pr-3 text-muted">{team.rosterSize ?? "—"}</td>
              <td className="py-2.5 pr-3">
                <ApplicationCell team={team} />
              </td>
              <td className="py-2.5 pr-3">
                <span className={cx(pillClass, STATUS_TONE[team.status])}>{team.status}</span>
                {team.status === "waitlisted" && team.waitlistRank !== null && (
                  <span className="ml-1.5 text-micro text-subtle">#{team.waitlistRank}</span>
                )}
              </td>
              {!locked && (
                <td className="py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {allowedFrom(team.status).map((to) => (
                      <form key={to} action={formAction}>
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="teamId" value={team.id} />
                        <input type="hidden" name="status" value={to} />
                        <button
                          type="submit"
                          disabled={pending}
                          data-testid={`move-${team.bidCode}-${to}`}
                          className="rounded border border-border px-1.5 py-0.5 text-micro text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                        >
                          {to}
                        </button>
                      </form>
                    ))}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {state.message && (
        <p
          role="status"
          data-testid="roster-message"
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
