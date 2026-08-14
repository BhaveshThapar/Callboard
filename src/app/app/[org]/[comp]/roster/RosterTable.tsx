"use client";

import { useActionState } from "react";
import { cardClass, cx, eyebrowClass, pillClass } from "@/components/styles";
import type { CustomField, TeamStatus } from "@/db/schema";
import type { RosterTeamView } from "@/lib/auth/scope";
import { describeBalance, formatCents } from "@/lib/money/format";
import { allowedFrom } from "@/lib/roster/transitions";
import { setTeamBillingAction, setTeamStatusAction, setWaitlistRankAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import type { BoardFormScope } from "../state";
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
 * A3, on the screen: the roster row and what the team owes are one record. A team with no charges
 * reads "—" rather than $0.00, because a comp that bills nothing and a team that owes nothing are
 * different facts and only one of them is about the team.
 */
function BalanceCell({ team }: { team: RosterTeamView }) {
  if (team.charges.length === 0 && team.balance.paidCents === 0) {
    return <span className="text-caption text-subtle">—</span>;
  }

  const { balanceCents, owedCents, paidCents } = team.balance;

  return (
    <div data-testid={`roster-balance-${team.bidCode}`} data-balance-cents={balanceCents}>
      <span
        className={cx(
          "tabular font-medium",
          balanceCents > 0 ? "text-heading" : balanceCents < 0 ? "text-primary" : "text-subtle",
        )}
      >
        {describeBalance(balanceCents)}
      </span>
      <span className="block text-caption text-subtle">
        {formatCents(paidCents)} of {formatCents(owedCents)}
      </span>
    </div>
  );
}

const countClass =
  "tabular w-12 rounded border border-border bg-transparent px-1 py-0.5 text-caption text-heading focus:border-primary focus:outline-none";

/**
 * The two numbers a team is billed on, and the only place either can be stated.
 *
 * `rooms` had no writer outside the seed until now, so a comp charging per room could not bill one
 * to any team that registered through the product — `generateCharges` withheld the line and said
 * "room count unknown", correctly and permanently. `rosterSize` arrived on the application and then
 * could never be corrected, so a team that lost two dancers in February kept February's bill.
 *
 * Blank is *not yet known* and 0 is a stated zero — the distinction `BillableTeam` draws and the
 * whole gap machinery rests on — so the input is left empty rather than defaulted, and the server
 * parses "" back to null rather than to `Number("")`.
 */
function BillingCell({
  team,
  scope,
  locked,
  action,
  pending,
}: {
  team: RosterTeamView;
  scope: BoardFormScope;
  locked: boolean;
  action: (payload: FormData) => void;
  pending: boolean;
}) {
  if (locked) {
    return (
      <span className="tabular text-caption text-muted">
        {team.rosterSize ?? "—"} / {team.rooms ?? "—"}
      </span>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1">
      <ScopeFields scope={scope} />
      <input type="hidden" name="teamId" value={team.id} />
      <input
        type="number"
        name="rosterSize"
        min={0}
        step={1}
        defaultValue={team.rosterSize ?? ""}
        placeholder="—"
        aria-label={`Dancers for ${team.name}`}
        data-testid={`billing-dancers-${team.bidCode}`}
        className={countClass}
      />
      <input
        type="number"
        name="rooms"
        min={0}
        step={1}
        defaultValue={team.rooms ?? ""}
        placeholder="—"
        aria-label={`Rooms for ${team.name}`}
        data-testid={`billing-rooms-${team.bidCode}`}
        className={countClass}
      />
      <button
        type="submit"
        disabled={pending}
        data-testid={`billing-save-${team.bidCode}`}
        className={stepClass}
      >
        save
      </button>
    </form>
  );
}

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
  scope,
  roster,
  locked,
  fields,
}: {
  scope: BoardFormScope;
  roster: RosterTeamView[];
  locked: boolean;
  fields: CustomField[];
}) {
  const [state, formAction, pending] = useActionState(setTeamStatusAction, IDLE);
  const [rankState, rankAction, rankPending] = useActionState(setWaitlistRankAction, IDLE);
  const [billingState, billingAction, billingPending] = useActionState(setTeamBillingAction, IDLE);

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
            <th className={cx(eyebrowClass, "pb-2")} title="What this team is billed on">
              Dancers / rooms
            </th>
            <th className={cx(eyebrowClass, "pb-2")}>Application</th>
            <th className={cx(eyebrowClass, "pb-2")}>Balance</th>
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
              <td className="py-2.5 pr-3">
                <BillingCell
                  team={team}
                  scope={scope}
                  locked={locked}
                  action={billingAction}
                  pending={billingPending}
                />
              </td>
              <td className="py-2.5 pr-3">
                <ApplicationCell team={team} fields={fields} />
              </td>
              <td className="py-2.5 pr-3">
                <BalanceCell team={team} />
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
                        <ScopeFields scope={scope} />
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
                        <ScopeFields scope={scope} />
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

      {billingState.message && (
        <p
          role="status"
          data-testid="roster-billing-message"
          className={cx(
            "mt-3 text-caption",
            billingState.status === "error" ? "text-danger" : "text-muted",
          )}
        >
          {billingState.message}
        </p>
      )}

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
