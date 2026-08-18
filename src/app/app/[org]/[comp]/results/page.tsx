import { notFound } from "next/navigation";
import type { BoardFormScope } from "../state";
import Link from "next/link";
import { cardClass, eyebrowClass } from "@/components/styles";
import { listTeamsForBoard } from "@/lib/auth/scope";
import { resolveBoardAccessBySlugs } from "@/lib/auth/access";
import { rubricForBoard } from "@/lib/comp/rubric";
import { latestLockedRun, reproduce } from "@/lib/comp/tab";
import { PrintButton } from "./PrintButton";
import { RubricPanel } from "./RubricPanel";
import { SendFeedback } from "./SendFeedback";

export const dynamic = "force-dynamic";

/**
 * PRD B8, the emcee's sheet. Read off a screen or off paper, which is why it prints. Every number
 * comes from the frozen snapshot, so what is read aloud is what was locked -- removing the
 * hand-retype step that the placements currently pass through.
 */
export default async function ResultsPage({ params }: { params: Promise<{ org: string; comp: string }> }) {
  const { org, comp } = await params;

  const actor = await resolveBoardAccessBySlugs(org, comp);
  if (!actor) notFound();

  const scope: BoardFormScope = { compId: actor.compId, basePath: `/app/${org}/${comp}` };

  /**
   * Before the lock this page used to `notFound()`, which was fine when nothing linked to it and is
   * not fine now that the shell does.
   *
   * A nav item that 404s is the defect this repo has been bitten by twice — a credential whose whole
   * journey ended on a page that refused to load, and a landing page linking three roles at a page
   * only one could open. The tab is correct to exist: results are a thing this comp will have. What
   * it must not do is imply the board did something wrong by clicking it.
   */
  const rubric = await rubricForBoard(actor);
  const locked = await latestLockedRun(actor.compId);
  if (!locked) {
    const empty = (
      <div className={cardClass} data-testid="results-not-locked">
        <h2 className="text-card font-semibold text-heading">Nothing is locked yet</h2>
        <p className="mt-2 text-body text-muted">
          Placements appear here once the board locks the results, and they are read from the frozen
          snapshot rather than recomputed — so what is printed is what was locked.
        </p>
        <Link
          href={scope.basePath}
          className="mt-4 inline-block text-card font-medium text-primary underline underline-offset-2"
        >
          Back to scoring →
        </Link>
      </div>
    );

    // Before the lock is exactly when a board authors its rubric, so the builder renders here too
    // rather than only on a screen that needs a locked result to reach. This branch is what a comp
    // being set up actually sees.
    return (
      <>
        {empty}
        {rubric && <RubricPanel scope={scope} rubric={rubric} />}
      </>
    );
  }

  const teams = await listTeamsForBoard(actor);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const placements = [...locked.results.placements].sort((a, b) => a.place - b.place);

  // The board screen refuses to announce a snapshot that does not reproduce. This is the page
  // someone actually reads placements off, so it must refuse at least as loudly -- and it must
  // never carry the footer claiming otherwise. The banner prints, because the sheet gets printed.
  const { matches } = reproduce(locked);

  return (
    <div className="max-w-2xl print:max-w-none print:px-0 print:py-0">
      {!matches && (
        <div
          role="alert"
          data-testid="reproduction-failure"
          className="mb-8 rounded-card border-2 border-danger bg-danger-light p-4"
        >
          <p className="text-card font-bold text-danger">
            This snapshot does not reproduce. Do not announce these placements.
          </p>
          <p className="mt-1 text-caption text-danger">
            Re-running the tabulation against the frozen inputs did not return the stored result.
            The record cannot be trusted until this is understood.
          </p>
        </div>
      )}

      <header className="flex items-start justify-between gap-6">
        <div>
          <p className={eyebrowClass}>{actor.compName}</p>
          <h1 className="mt-1 text-title font-bold text-heading">Final placements</h1>
          <p className="mt-1 text-caption text-muted">
            Locked {locked.lockedAt.toLocaleString()}
            {locked.overrideReason && ` · corrected: ${locked.overrideReason}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 print:hidden">
          <PrintButton />
        </div>
      </header>

      <ol className="mt-8 space-y-1">
        {placements.map((placement) => {
          const team = byId.get(placement.teamId);
          return (
            <li
              key={placement.teamId}
              className="flex items-baseline gap-4 border-b border-border-soft py-3 last:border-0"
            >
              <span className="tabular w-8 shrink-0 text-title font-bold text-heading">
                {placement.place}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-card font-semibold text-heading">
                  {team?.name ?? placement.teamId}
                </span>
                {team?.school && (
                  <span className="ml-2 text-caption text-muted">{team.school}</span>
                )}
              </span>
              {placement.deductionPoints > 0 && (
                <span className="tabular shrink-0 text-caption font-semibold text-secondary">
                  −{placement.deductionPoints}
                </span>
              )}
              {team && (
                <a
                  href={`${scope.basePath}/feedback?team=${encodeURIComponent(team.bidCode)}`}
                  data-testid={`feedback-link-${team.bidCode}`}
                  className="shrink-0 text-caption text-muted underline print:hidden"
                >
                  Feedback
                </a>
              )}
            </li>
          );
        })}
      </ol>

      {locked.results.unresolvedTies.length > 0 && (
        <p className="mt-6 text-body text-danger">
          Unresolved tie — do not announce until it is settled by hand.
        </p>
      )}

      <p className="mt-6 text-caption text-muted print:hidden">
        Each team&rsquo;s feedback file carries its placement, its deduction and the reason for it,
        and what each judge wrote — with no scores, and no judge named. One file per team, so
        forwarding one cannot send a team its rivals&rsquo; notes.
      </p>

      {/* The same projection, delivered rather than downloaded. Keyed on the team *and* this run,
          so a correction can be sent and a second click cannot reach anybody twice. */}
      <SendFeedback scope={scope} teams={placements.length} />

      {rubric && <RubricPanel scope={scope} rubric={rubric} />}

      <footer className="mt-10 flex items-center justify-between gap-4 text-micro text-subtle">
        <span>
          {matches
            ? "Reproduced from the locked snapshot. Callboard."
            : "Read from a locked snapshot that does not reproduce. Callboard."}
        </span>
        <Link href={scope.basePath} className="underline print:hidden">
          Back to the board
        </Link>
      </footer>
    </div>
  );
}
