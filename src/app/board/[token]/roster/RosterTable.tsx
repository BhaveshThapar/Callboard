"use client";

import { useActionState } from "react";
import { cardClass, cx, eyebrowClass, pillClass } from "@/components/styles";
import type { CustomField, TeamStatus } from "@/db/schema";
import type { RosterTeamView } from "@/lib/auth/scope";
import { allowedFrom } from "@/lib/roster/transitions";
import { setTeamStatusAction, setWaitlistRankAction } from "../actions";
import { IDLE } from "../state";

const stepClass =
  "rounded border border-border px-1 text-micro leading-4 text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted";

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
function ApplicationCell({ team, fields }: { team: RosterTeamView; fields: CustomField[] }) {
  if (!team.auditionUrl && !team.waiverAcceptedAt) {
    return <span className="text-caption text-subtle">—</span>;
  }

  // Driven by the comp's field list rather than by the answer map's own keys, so the board reads
  // its questions in the order it asked them — and a question added after this team applied shows
  // as unanswered rather than silently vanishing.
  const answered = fields.flatMap((field) => {
    const value = team.customAnswers?.[field.id];
    if (value === undefined) return [];
    return [{ field, text: typeof value === "boolean" ? (value ? "yes" : "no") : String(value) }];
  });

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
      {answered.map(({ field, text }) => (
        <span
          key={field.id}
          data-testid={`roster-answer-${team.bidCode}-${field.id}`}
          className="text-micro text-subtle"
        >
          <span className="text-subtle">{field.label}:</span>{" "}
          <span className="text-muted">{text}</span>
        </span>
      ))}
    </div>
  );
}

export function RosterTable({
  token,
  roster,
  locked,
  fields,
}: {
  token: string;
  roster: RosterTeamView[];
  locked: boolean;
  fields: CustomField[];
}) {
  const [state, formAction, pending] = useActionState(setTeamStatusAction, IDLE);
  const [rankState, rankAction, rankPending] = useActionState(setWaitlistRankAction, IDLE);

  const counts = roster.reduce<Record<string, number>>((acc, team) => {
    acc[team.status] = (acc[team.status] ?? 0) + 1;
    return acc;
  }, {});

  // Which team is at each end of the queue, so the button that cannot do anything says so. This
  // reads the *displayed* order, which is the board's own view of the list; the server resolves the
  // move against the promotion order and refuses a boundary itself, because the button is not the
  // guarantee. The two agree except on teams sharing a rank, where neither order is stated.
  const queue = roster.filter((team) => team.status === "waitlisted");
  const firstInQueue = queue[0]?.id;
  const lastInQueue = queue[queue.length - 1]?.id;

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
                <ApplicationCell team={team} fields={fields} />
              </td>
              <td className="py-2.5 pr-3">
                <span className={cx(pillClass, STATUS_TONE[team.status])}>{team.status}</span>
                {team.status === "waitlisted" && team.waitlistRank !== null && (
                  <span
                    data-testid={`roster-rank-${team.bidCode}`}
                    className="ml-1.5 text-micro text-subtle"
                  >
                    #{team.waitlistRank}
                  </span>
                )}
                {team.status === "waitlisted" && !locked && (
                  <span className="ml-1.5 inline-flex gap-0.5 align-middle">
                    {(["up", "down"] as const).map((direction) => (
                      <form key={direction} action={rankAction} className="inline">
                        <input type="hidden" name="token" value={token} />
                        <input type="hidden" name="teamId" value={team.id} />
                        <input type="hidden" name="direction" value={direction} />
                        <button
                          type="submit"
                          disabled={
                            rankPending ||
                            team.id === (direction === "up" ? firstInQueue : lastInQueue)
                          }
                          data-testid={`rank-${team.bidCode}-${direction}`}
                          aria-label={`Move ${team.name} ${direction} the waitlist`}
                          className={stepClass}
                        >
                          {direction === "up" ? "↑" : "↓"}
                        </button>
                      </form>
                    ))}
                  </span>
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

      {rankState.message && (
        <p
          role="status"
          data-testid="roster-rank-message"
          className={cx(
            "mt-3 text-caption",
            rankState.status === "error" ? "text-danger" : "text-muted",
          )}
        >
          {rankState.message}
        </p>
      )}

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
