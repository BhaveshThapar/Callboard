"use client";

import { useActionState } from "react";
import {
  cardClass,
  cx,
  eyebrowClass,
  inputClass,
  pillClass,
  primaryButtonClass,
} from "@/components/styles";
import { addDelayAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import { IDLE } from "../state";

export type TimelineRow = {
  kind: string;
  ref: string;
  teamName: string | null;
  room: string | null;
  startsAt: string;
  endsAt: string;
};

export type SlackRow = {
  id: string;
  label: string;
  budgetedMinutes: number;
  consumedMinutes: number;
  remainingMinutes: number;
  exhausted: boolean;
};

export type GapRow = { kind: string; teamName: string | null; missing: string };

export type DelayRowView = { seq: number; minutes: number; fromPosition: number; reason: string };

const LABEL: Record<string, string> = {
  walk: "Walk",
  lobby: "Lobby",
  stretch: "Stretch",
  props: "Props",
  tech_in: "Tech in",
  tech_out: "Tech out",
  food: "Food",
  judge_cutoff: "Judge cutoff",
  transport: "Transport",
};

/**
 * G3 and G6 — the run of show, and what a delay has already cost.
 *
 * The one new capability PRD §9 names: *"a single 'running N minutes behind' input that re-derives
 * the entire cascade — the cell that doesn't exist today."* Everything below the form is derived, so
 * there is nothing here to keep in step with anything else; entering a delay re-times the whole
 * board and every other role's page at once, because they all read the same derivation.
 */
export function SchedulePanel({
  compId,
  basePath,
  configured,
  live,
  timeline,
  slack,
  gaps,
  delays,
  totalDelayMinutes,
  unabsorbedMinutes,
  maxPosition,
}: {
  compId: string;
  basePath: string;
  configured: boolean;
  live: boolean;
  timeline: TimelineRow[];
  slack: SlackRow[];
  gaps: GapRow[];
  delays: DelayRowView[];
  totalDelayMinutes: number;
  unabsorbedMinutes: number;
  maxPosition: number;
}) {
  const [state, submit, pending] = useActionState(addDelayAction, IDLE);

  if (!configured) {
    return (
      <section className={cx(cardClass, "mt-6")} data-testid="schedule">
        <h3 className={eyebrowClass}>Run of show</h3>
        <p className="mt-3 text-body text-muted" data-testid="schedule-unconfigured">
          This comp has not written its run of show down, so there is nothing to derive. The buffers
          — how long a walk takes, what a stretch hangs off, how much slack is engineered in — are
          config, like the fee schedule and the rubric. Nothing is guessed here on purpose: a buffer
          nobody chose looks exactly like one somebody did, on a screen a liaison is following.
        </p>
      </section>
    );
  }

  return (
    <section className={cx(cardClass, "mt-6")} data-testid="schedule">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={eyebrowClass}>Run of show</h3>
        <span className="text-caption text-subtle" data-testid="schedule-delay-total">
          {totalDelayMinutes === 0
            ? "On time"
            : totalDelayMinutes > 0
              ? `Running ${totalDelayMinutes} min behind`
              : `Running ${Math.abs(totalDelayMinutes)} min ahead`}
        </span>
      </div>

      {gaps.length > 0 && (
        <ul className="mt-3 space-y-1" data-testid="schedule-gaps">
          {gaps.map((gap) => (
            <li key={`${gap.kind}-${gap.missing}`} className="text-caption text-danger">
              {LABEL[gap.kind] ?? gap.kind} is not derived: this comp has not said its{" "}
              {gap.missing}. Stated rather than assumed — a zero-minute walk is a lie somebody will
              believe standing in the wrong corridor.
            </li>
          ))}
        </ul>
      )}

      {slack.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" data-testid="schedule-slack">
          {slack.map((pool) => (
            <li
              key={pool.id}
              className={cx(pillClass, pool.exhausted && "text-danger")}
              data-testid={`schedule-slack-${pool.id}`}
            >
              {pool.label}: {pool.remainingMinutes} of {pool.budgetedMinutes} min left
            </li>
          ))}
        </ul>
      )}

      {unabsorbedMinutes > 0 && (
        <p className="mt-3 text-body text-danger" data-testid="schedule-unabsorbed">
          {unabsorbedMinutes} minutes no engineered slack can absorb. Something has to give — an act
          cut, a cutoff shortened. Which one is yours to decide; the schedule will not choose for
          you.
        </p>
      )}

      <ol className="mt-4 space-y-1" data-testid="schedule-timeline">
        {timeline.map((row, i) => (
          <li
            key={`${row.ref}-${row.teamName ?? ""}-${i}`}
            className="flex flex-wrap items-baseline gap-x-3 text-caption"
            data-testid="schedule-segment"
          >
            <span className="tabular-nums text-heading">{row.startsAt}</span>
            <span className="text-muted">{LABEL[row.kind] ?? row.kind}</span>
            <span className="text-heading">{row.teamName ?? ""}</span>
            {row.room && <span className="text-subtle">· {row.room}</span>}
            <span className="text-subtle">→ {row.endsAt}</span>
          </li>
        ))}
      </ol>

      <form action={submit} className="mt-5 flex flex-wrap items-end gap-2">
        <ScopeFields scope={{ compId, basePath }} />
        <label className="text-caption text-subtle">
          Minutes
          <input
            type="number"
            name="minutes"
            required
            defaultValue={10}
            className={cx(inputClass, "mt-1 w-24")}
            data-testid="delay-minutes"
          />
        </label>
        <label className="text-caption text-subtle">
          From act
          <input
            type="number"
            name="fromPosition"
            required
            min={1}
            max={Math.max(1, maxPosition)}
            defaultValue={1}
            className={cx(inputClass, "mt-1 w-24")}
            data-testid="delay-from"
          />
        </label>
        <label className="flex-1 text-caption text-subtle">
          What happened
          <input
            type="text"
            name="reason"
            required
            placeholder="stage tech overran"
            className={cx(inputClass, "mt-1 w-full")}
            data-testid="delay-reason"
          />
        </label>
        <button
          type="submit"
          disabled={pending || !live}
          className={primaryButtonClass}
          data-testid="delay-submit"
        >
          Re-time the show
        </button>
      </form>

      {!live && (
        <p className="mt-2 text-caption text-subtle" data-testid="schedule-not-live">
          Delays can be entered once the comp is <code>live</code>. Move it there from the roster
          screen on the morning of the show.
        </p>
      )}

      {delays.length > 0 && (
        <ol className="mt-4 space-y-1" data-testid="schedule-delays">
          {delays.map((delay) => (
            <li key={delay.seq} className="text-caption text-subtle">
              {delay.minutes > 0 ? `+${delay.minutes}` : delay.minutes} min from act{" "}
              {delay.fromPosition} — {delay.reason}
            </li>
          ))}
        </ol>
      )}

      {state.message && (
        <p
          className={cx(
            "mt-3 text-caption",
            state.status === "error" ? "text-danger" : "text-subtle",
          )}
          data-testid="schedule-message"
        >
          {state.message}
        </p>
      )}
    </section>
  );
}
