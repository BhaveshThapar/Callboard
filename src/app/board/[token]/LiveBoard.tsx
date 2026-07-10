"use client";

import { useActionState, useEffect, useState } from "react";
import { ProgressBar } from "@/components/ProgressBar";
import { Wordmark } from "@/components/Wordmark";
import { AlertIcon, CheckCircleIcon, ShieldIcon, UsersIcon } from "@/components/icons";
import {
  buttonClass,
  cardClass,
  cx,
  eyebrowClass,
  inputClass,
  lockButtonClass,
  overrideButtonClass,
  pillClass,
  primaryButtonClass,
} from "@/components/styles";
import type { BoardSnapshot } from "@/lib/comp/board";
import { addDeductionAction, lockAction, overrideAction, revokeJudgeAction } from "./actions";
import { IDLE } from "./state";

const POLL_MS = 2_000;

const METHOD_LABEL: Record<BoardSnapshot["method"], string> = {
  raw: "Raw weighted score",
  zscore: "Z-score normalized per judge",
  rank: "Mean judge rank",
};

const formatAggregate = (value: number, method: BoardSnapshot["method"]): string =>
  method === "rank" ? (-value).toFixed(2) : value.toFixed(3);

export function LiveBoard({
  token,
  initial,
  trail,
}: {
  token: string;
  initial: BoardSnapshot;
  trail: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [lockState, lockFormAction, locking] = useActionState(lockAction, IDLE);
  const [deductionState, deductionFormAction, deducting] = useActionState(addDeductionAction, IDLE);
  const [overrideState, overrideFormAction, overriding] = useActionState(overrideAction, IDLE);
  const [revokeState, revokeFormAction, revoking] = useActionState(revokeJudgeAction, IDLE);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/board/${token}`, { cache: "no-store" });
        if (!response.ok) return;
        const next = (await response.json()) as BoardSnapshot;
        if (!cancelled) setSnapshot(next);
      } catch {
        // A dropped poll is not an error worth showing; the next tick will catch up.
      }
    };

    const id = setInterval(poll, POLL_MS);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, lockState, deductionState, overrideState, revokeState]);

  const progress =
    snapshot.scoresExpected > 0
      ? Math.round((snapshot.scoresSubmitted / snapshot.scoresExpected) * 100)
      : 0;
  const judgesReporting = snapshot.judges.filter((j) => j.submitted >= j.expected).length;

  return (
    <div className="mx-auto flex w-full max-w-[1420px] flex-col gap-6 px-4 py-8 lg:flex-row lg:px-6">
      <aside className="w-full shrink-0 lg:sticky lg:top-8 lg:w-[220px] lg:self-start">
        <Wordmark />

        <div className="mt-8">
          <p className={eyebrowClass}>Comp</p>
          <p className="mt-2 text-body font-medium text-heading">{snapshot.compName}</p>
          <p className="mt-0.5 text-caption text-muted">{METHOD_LABEL[snapshot.method]}</p>
        </div>

        <div className="mt-7">
          <p className={eyebrowClass}>Judges</p>
          <ul className="mt-3 space-y-3.5">
            {snapshot.judges.map((judge) => (
              <li key={judge.assignmentId}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-caption font-medium text-heading">
                    {judge.name}
                    {judge.revoked && (
                      <span className={cx(pillClass, "ml-1.5 bg-hover text-subtle")}>revoked</span>
                    )}
                  </span>
                  <span className="tabular shrink-0 text-micro text-subtle">
                    {judge.submitted}/{judge.expected}
                  </span>
                </div>
                <div className="mt-1.5">
                  <ProgressBar
                    value={judge.submitted}
                    max={judge.expected}
                    tone={judge.submitted >= judge.expected ? "primary" : "secondary"}
                  />
                </div>
                {!snapshot.locked && !judge.revoked && (
                  <form action={revokeFormAction} className="mt-1">
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="assignmentId" value={judge.assignmentId} />
                    <button
                      type="submit"
                      disabled={revoking}
                      data-testid={`revoke-${judge.assignmentId}`}
                      className="text-micro text-subtle underline underline-offset-2 transition-colors hover:text-danger disabled:opacity-40"
                    >
                      Revoke link
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {revokeState.message && (
            <p
              role="status"
              className={cx(
                "mt-3 text-micro",
                revokeState.status === "error" ? "text-danger" : "text-subtle",
              )}
            >
              {revokeState.message}
            </p>
          )}
        </div>

        <div className="mt-7 flex items-center gap-2 border-t border-border-soft pt-5">
          <span
            className={cx(
              "size-1.5 shrink-0 rounded-full",
              snapshot.locked ? "bg-heading" : "bg-primary",
            )}
            aria-hidden
          />
          <span className="text-caption font-medium text-muted">
            {snapshot.locked ? "Locked" : "Scoring open"}
          </span>
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-6 lg:max-w-[860px]">
        <header className="animate-fade-in-up">
          <p className={eyebrowClass}>{snapshot.compName}</p>
          <h1 className="mt-1 text-title font-bold text-heading">
            {snapshot.locked ? "Final placements" : "Live standings"}
          </h1>
          <p className="mt-1 text-body text-muted">
            {METHOD_LABEL[snapshot.method]} · {snapshot.judges.length} judges
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className={cx(cardClass, "animate-fade-in-up")} style={{ animationDelay: "0.05s" }}>
            <div className="flex items-center justify-between">
              <p className="text-caption font-medium text-muted">Scores submitted</p>
              <div className="flex size-8 items-center justify-center rounded-md bg-primary-light text-primary">
                <CheckCircleIcon className="size-4" />
              </div>
            </div>
            <p className="tabular mt-3 text-metric font-bold text-heading" data-testid="progress">
              {snapshot.scoresSubmitted} / {snapshot.scoresExpected}
            </p>
            <div className="mt-3">
              <ProgressBar value={snapshot.scoresSubmitted} max={snapshot.scoresExpected} />
            </div>
            <p className="mt-2 text-micro text-subtle">{progress}% complete</p>
          </div>

          <div className={cx(cardClass, "animate-fade-in-up")} style={{ animationDelay: "0.1s" }}>
            <div className="flex items-center justify-between">
              <p className="text-caption font-medium text-muted">Judges reporting</p>
              <div className="flex size-8 items-center justify-center rounded-md bg-secondary-light text-secondary">
                <UsersIcon className="size-4" />
              </div>
            </div>
            <p className="tabular mt-3 text-metric font-bold text-heading">
              {judgesReporting} / {snapshot.judges.length}
            </p>
            <p className="mt-3 text-micro text-subtle">
              {judgesReporting === snapshot.judges.length
                ? "Every judge has finished."
                : `${snapshot.judges.length - judgesReporting} still scoring.`}
            </p>
          </div>

          <VerificationTile snapshot={snapshot} />
        </div>

        {!snapshot.locked && (
          <p className={cx(cardClass, "text-body text-muted")}>
            Teams show as bid codes until results are locked. Names are revealed on the lock.
          </p>
        )}

        {snapshot.unresolvedTies.length > 0 && (
          <div
            role="alert"
            className="flex gap-3 rounded-card border border-secondary/30 bg-secondary-light p-4 text-body"
          >
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-secondary" />
            <span>
              <strong className="font-semibold">Unresolved tie.</strong> No configured tiebreaker
              separated {snapshot.unresolvedTies.map((g) => g.join(" and ")).join("; ")}. Resolve it
              by hand before announcing.
            </span>
          </div>
        )}

        <table className="w-full border-collapse overflow-hidden rounded-card border border-border bg-surface text-body shadow-card">
          <thead>
            <tr className="border-b border-border text-left text-caption uppercase tracking-wide text-subtle">
              <th className="px-4 py-3 font-medium">Place</th>
              <th className="px-4 py-3 font-medium">Team</th>
              <th className="px-4 py-3 text-right font-medium">Score</th>
              <th className="px-4 py-3 text-right font-medium">Deduction</th>
              <th className="px-4 py-3 text-right font-medium">Judges</th>
            </tr>
          </thead>
          <tbody data-testid="standings">
            {snapshot.standings.map((row, index) => (
              <tr
                key={row.teamId}
                className="animate-fade-in-up border-b border-border-soft transition-colors last:border-0 hover:bg-app"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <td className="tabular px-4 py-3 font-bold text-heading">{row.place}</td>
                <td className="px-4 py-3 font-medium text-heading">
                  {row.label}
                  {row.tiedWith.length > 0 && (
                    <span className={cx(pillClass, "ml-2 bg-secondary-light text-secondary")}>
                      tied
                    </span>
                  )}
                  {row.resolvedBy && (
                    <span className="ml-2 text-caption font-normal text-subtle">
                      won on {row.resolvedBy.replace(/_/g, " ")}
                    </span>
                  )}
                </td>
                <td className="tabular px-4 py-3 text-right font-semibold text-heading">
                  {formatAggregate(row.aggregate, snapshot.method)}
                </td>
                <td className="tabular px-4 py-3 text-right">
                  {row.deductionPoints > 0 ? (
                    <span className="font-semibold text-secondary">−{row.deductionPoints}</span>
                  ) : (
                    <span className="text-subtle">—</span>
                  )}
                </td>
                <td className="tabular px-4 py-3 text-right text-muted">{row.judgeCount}</td>
              </tr>
            ))}
            {snapshot.standings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  No scores yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {snapshot.unscored.length > 0 && (
          <p className="text-body text-muted">Not yet scored: {snapshot.unscored.join(", ")}</p>
        )}

        {!snapshot.locked && (
          <div className="grid gap-4 md:grid-cols-2">
            <form action={deductionFormAction} className={cardClass}>
              <input type="hidden" name="token" value={token} />
              <h2 className="text-card font-semibold text-heading">Add a deduction</h2>
              <p className="mt-1 text-caption text-muted">
                Applied to every judge&apos;s total for that team, before normalization.
              </p>
              <div className="mt-4 space-y-2">
                <select name="teamId" required aria-label="Team" className={inputClass}>
                  <option value="">Select a team…</option>
                  {snapshot.standings.map((row) => (
                    <option key={row.teamId} value={row.teamId}>
                      {row.label}
                    </option>
                  ))}
                </select>
                <input
                  name="points"
                  type="number"
                  min={1}
                  step={1}
                  required
                  placeholder="Points"
                  aria-label="Points"
                  className={cx(inputClass, "tabular")}
                />
                <input
                  name="reason"
                  type="text"
                  required
                  placeholder="Reason (e.g. exceeded time by 14s)"
                  aria-label="Reason"
                  className={inputClass}
                />
              </div>
              <button type="submit" disabled={deducting} className={cx(primaryButtonClass, "mt-4")}>
                {deducting ? "Applying…" : "Apply deduction"}
              </button>
              {deductionState.message && (
                <p
                  role="status"
                  className={cx(
                    "mt-2 text-caption",
                    deductionState.status === "error" ? "text-danger" : "text-muted",
                  )}
                >
                  {deductionState.message}
                </p>
              )}
            </form>

            <form action={lockFormAction} className={cardClass}>
              <input type="hidden" name="token" value={token} />
              <h2 className="text-card font-semibold text-heading">Lock results</h2>
              <p className="mt-1 text-caption text-muted">
                Freezes the scores, the rubric, and the placements into one auditable snapshot.
                Scoring closes. Names are revealed.
              </p>
              <button
                type="submit"
                data-testid="lock-button"
                disabled={locking || snapshot.scoresSubmitted === 0}
                className={cx(lockButtonClass, "mt-4")}
              >
                {locking ? "Locking…" : "Lock results"}
              </button>
              {lockState.message && (
                <p
                  role="status"
                  className={cx(
                    "mt-2 text-caption",
                    lockState.status === "error" ? "text-danger" : "text-muted",
                  )}
                >
                  {lockState.message}
                </p>
              )}
            </form>
          </div>
        )}

        {snapshot.locked && (
          <div className="space-y-4">
            <div className={cx(cardClass, "text-body")}>
              <p>
                Run <strong className="font-semibold tabular">{snapshot.lockedRunNumber}</strong>, locked
                at{" "}
                <strong className="font-semibold">
                  {new Date(snapshot.lockedAt!).toLocaleString()}
                </strong>
                {snapshot.supersedesId && " — a correction of the run before it"}.
              </p>
              {snapshot.overrideReason && (
                <p className="mt-1 text-muted">Reason given: {snapshot.overrideReason}</p>
              )}
              <p className="mt-2 text-muted">
                {snapshot.reproduces
                  ? "Re-running the tabulation against the stored snapshot reproduces these exact placements."
                  : "The stored snapshot does not reproduce. Do not announce these results."}
              </p>

              <div className="mt-4 flex flex-wrap gap-3 border-t border-border-soft pt-4">
                <a
                  href={`/board/${token}/results`}
                  data-testid="emcee-link"
                  className={buttonClass}
                >
                  Emcee sheet
                </a>
                <a href={`/board/${token}/feedback`} data-testid="feedback-link" className={buttonClass}>
                  Download feedback CSV
                </a>
              </div>
            </div>

            <form
              action={overrideFormAction}
              className={cx(cardClass, "border-danger/30 bg-danger-light/40")}
            >
              <input type="hidden" name="token" value={token} />
              <h2 className="text-card font-semibold text-heading">Correct these results</h2>
              <p className="mt-1 text-caption text-muted">
                Nothing above is edited. A correction records a deduction, re-runs the tabulation,
                and writes a new run that supersedes run {snapshot.lockedRunNumber} — with your name
                and your reason attached. Scores stay frozen.
              </p>

              <div className="mt-4 space-y-2">
                <textarea
                  name="overrideReason"
                  required
                  rows={2}
                  placeholder="Why are these results being corrected?"
                  aria-label="Reason for the correction"
                  className={cx(inputClass, "resize-y")}
                />
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <select name="teamId" aria-label="Team to deduct from" className={inputClass}>
                    <option value="">No deduction — re-tabulate only</option>
                    {snapshot.standings.map((row) => (
                      <option key={row.teamId} value={row.teamId}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                  <input
                    name="points"
                    type="number"
                    min={1}
                    step={1}
                    placeholder="Points"
                    aria-label="Deduction points"
                    className={cx(inputClass, "tabular sm:w-28")}
                  />
                </div>
                <input
                  name="reason"
                  type="text"
                  placeholder="Reason for the deduction (e.g. missed time penalty)"
                  aria-label="Reason for the deduction"
                  className={inputClass}
                />
              </div>

              <button
                type="submit"
                data-testid="override-button"
                disabled={overriding}
                className={cx(overrideButtonClass, "mt-4")}
              >
                {overriding ? "Correcting…" : "Correct and re-lock"}
              </button>
              {overrideState.message && (
                <p
                  role="status"
                  className={cx(
                    "mt-2 text-caption",
                    overrideState.status === "error" ? "text-danger" : "text-muted",
                  )}
                >
                  {overrideState.message}
                </p>
              )}
            </form>
          </div>
        )}
      </div>

      <aside className="w-full shrink-0 lg:sticky lg:top-8 lg:w-[340px] lg:self-start">
        {trail}
      </aside>
    </div>
  );
}

/**
 * A ✗ here means the locked snapshot no longer reproduces and the placements must not be
 * announced, so this tile carries its own fill rather than relying on the green used for buttons.
 */
function VerificationTile({ snapshot }: { snapshot: BoardSnapshot }) {
  if (!snapshot.locked) {
    return (
      <div className={cx(cardClass, "animate-fade-in-up")} style={{ animationDelay: "0.15s" }}>
        <div className="flex items-center justify-between">
          <p className="text-caption font-medium text-muted">Reproducibility</p>
          <div className="flex size-8 items-center justify-center rounded-md bg-hover text-subtle">
            <ShieldIcon className="size-4" />
          </div>
        </div>
        <p className="mt-3 text-metric font-bold leading-none text-subtle">—</p>
        <p className="mt-3 text-micro text-subtle">Checked when results are locked.</p>
      </div>
    );
  }

  const reproduces = snapshot.reproduces === true;
  const tone = reproduces ? "text-primary" : "text-danger";

  return (
    <div
      data-testid="verification"
      data-reproduces={String(snapshot.reproduces)}
      className={cx(
        "animate-fade-in-up rounded-card border p-5 shadow-card",
        reproduces ? "border-primary/30 bg-primary-light" : "border-danger/30 bg-danger-light",
      )}
      style={{ animationDelay: "0.15s" }}
    >
      <div className="flex items-center justify-between">
        <p className={cx("text-caption font-medium", tone)}>Reproducibility</p>
        <div
          className={cx(
            "flex size-8 items-center justify-center rounded-md",
            reproduces ? "bg-primary text-on-primary" : "bg-danger text-white",
          )}
        >
          <ShieldIcon className="size-4" />
        </div>
      </div>
      <p className={cx("mt-3 text-metric font-bold leading-none", tone)}>
        {reproduces ? "✓" : "✗"}
      </p>
      <p className={cx("mt-2 text-card font-semibold", tone)}>
        {reproduces ? "Snapshot reproduces" : "Snapshot mismatch"}
      </p>
      <p className={cx("mt-2 text-micro", tone)}>
        {reproduces ? "Safe to announce." : "Do not announce these results."}
      </p>
    </div>
  );
}
