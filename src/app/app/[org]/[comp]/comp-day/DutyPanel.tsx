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
import type { DutyConfig } from "@/db/schema";
import type { BoardAssignmentView } from "@/lib/coord/assignments";
import { labelFor, resolveDuty } from "@/lib/coord/duties";
import { assignDutyAction, revokeDutyAction, setSwaTrainedAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import { IDLE } from "../state";

const when = (at: Date | null): string =>
  at
    ? new Date(at).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

/**
 * The board's half of comp day.
 *
 * The duty dropdown is built from the comp's own `duties` config, so a board that has not written
 * its list down sees a sentence saying so rather than an empty select it could not act on — the same
 * reason the money screen says what it cannot bill instead of showing zeroes.
 */
export function DutyPanel({
  compId,
  basePath,
  duties,
  assignments,
  people,
  teams,
}: {
  compId: string;
  basePath: string;
  duties: DutyConfig[];
  assignments: BoardAssignmentView[];
  people: { personId: string; name: string; pending: boolean }[];
  teams: { id: string; name: string }[];
}) {
  const scope = { compId, basePath };
  const [assignState, assign] = useActionState(assignDutyAction, IDLE);
  const [rowState, act] = useActionState(revokeDutyAction, IDLE);
  const [swaState, swa] = useActionState(setSwaTrainedAction, IDLE);
  const [dutyId, setDutyId] = useState(duties[0]?.id ?? "");

  const selected = resolveDuty(duties, dutyId);
  const needsTeam = selected?.category === "team";

  if (duties.length === 0) {
    return (
      <div className={cardClass} data-testid="no-duties-configured">
        <p className="text-body text-subtle">
          This comp has not written down what its duties are, so there is nothing to assign yet. The
          list lives in the comp config beside the fee schedule — one entry per duty, each with a
          category.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form action={assign} className={cardClass} data-testid="assign-duty">
        <ScopeFields scope={scope} />
        <p className={eyebrowClass}>Assign a duty</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-caption text-subtle">
            Person
            <select name="personId" className={inputClass} required data-testid="duty-person">
              <option value="">Pick somebody…</option>
              {people.map((p) => (
                <option key={p.personId} value={p.personId}>
                  {p.name}
                  {p.pending ? " — has not signed in yet" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="text-caption text-subtle">
            Duty
            <select
              name="dutyId"
              className={inputClass}
              value={dutyId}
              onChange={(e) => setDutyId(e.target.value)}
              data-testid="duty-kind"
            >
              {duties.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          {/* Shown exactly when the duty is about a team, which is what `assignments_team_check`
              enforces and `planAssignment` explains. The field is not merely hidden — an unrelated
              duty carrying a team is refused server-side too. */}
          {needsTeam && (
            <label className="text-caption text-subtle">
              Team
              <select name="teamId" className={inputClass} required data-testid="duty-team">
                <option value="">Pick a team…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="text-caption text-subtle">
            Starts
            <input type="datetime-local" name="startsAt" className={inputClass} />
          </label>
          <label className="text-caption text-subtle">
            Ends
            <input type="datetime-local" name="endsAt" className={inputClass} />
          </label>
          <label className="text-caption text-subtle sm:col-span-2">
            Note
            <input type="text" name="note" className={inputClass} maxLength={200} />
          </label>
        </div>

        {selected?.help && <p className="text-caption text-subtle mt-3">{selected.help}</p>}

        <button type="submit" className={cx(primaryButtonClass, "mt-4")}>
          Assign
        </button>

        {assignState.status !== "idle" && (
          <p
            className={cx(
              "text-caption mt-3",
              assignState.status === "error" ? "text-danger" : "text-subtle",
            )}
            data-testid="assign-duty-result"
          >
            {assignState.message}
          </p>
        )}
      </form>

      <div className={cardClass}>
        <p className={eyebrowClass}>Assigned</p>

        {assignments.length === 0 ? (
          <p className="text-body text-subtle mt-3" data-testid="nobody-assigned">
            Nobody is on a duty yet.
          </p>
        ) : (
          <table className="mt-3 w-full text-body" data-testid="assignments">
            <tbody>
              {assignments.map((a) => {
                const duty = resolveDuty(duties, a.dutyId);
                return (
                  <tr key={a.id} className="border-t border-subtle" data-assignment={a.id}>
                    <td className="py-2">
                      <div className="text-heading">{a.personName}</div>
                      <div className="text-caption text-subtle">
                        {labelFor(duties, a.dutyId)}
                        {a.teamName ? ` · ${a.teamName}` : ""}
                      </div>
                    </td>
                    <td className="py-2 text-caption text-subtle">
                      {when(a.startsAt)}
                      {a.endsAt ? ` – ${when(a.endsAt)}` : ""}
                    </td>
                    <td className="py-2">
                      {a.completedAt ? (
                        <span className={pillClass} data-testid="duty-done">
                          Done
                        </span>
                      ) : a.acknowledgedAt ? (
                        <span className={pillClass}>Acknowledged</span>
                      ) : (
                        <span className="text-caption text-subtle">Not seen yet</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {/* The SWA checklist PRD §7.3 asks for, and only where the duty requires it —
                          a mark on a duty that never needed training is a number nobody can read. */}
                      {duty?.swaRequired && (
                        <form action={swa} className="inline">
                          <ScopeFields scope={scope} />
                          <input type="hidden" name="assignmentId" value={a.id} />
                          <input
                            type="hidden"
                            name="trained"
                            value={a.swaTrainedAt ? "false" : "true"}
                          />
                          <button
                            type="submit"
                            className="text-caption underline"
                            data-testid="swa-toggle"
                          >
                            {a.swaTrainedAt ? "SWA ✓" : "Mark SWA"}
                          </button>
                        </form>
                      )}
                      <form action={act} className="ml-3 inline">
                        <ScopeFields scope={scope} />
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <button
                          type="submit"
                          className="text-caption underline"
                          data-testid="revoke-duty"
                        >
                          Take back
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {(rowState.status !== "idle" || swaState.status !== "idle") && (
          <p className="text-caption text-subtle mt-3" data-testid="duty-row-result">
            {rowState.message ?? swaState.message}
          </p>
        )}
      </div>
    </div>
  );
}
