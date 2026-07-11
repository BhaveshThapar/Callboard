import { notFound } from "next/navigation";
import { LockIcon } from "@/components/icons";
import { eyebrowClass } from "@/components/styles";
import { resolveJudgeActor } from "@/lib/auth/scope";
import { judgeSnapshot } from "@/lib/comp/judge";
import { TeamScoreCard } from "./TeamScoreCard";

export const dynamic = "force-dynamic";

export default async function JudgePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const actor = await resolveJudgeActor(token);
  if (!actor) notFound();

  const { teams, rubric, scores, notes, locked } = await judgeSnapshot(actor);

  return (
    <div className="judge-shell bg-app">
      <main className="mx-auto max-w-lg px-4 py-8">
        <header className="mb-6 animate-fade-in-up">
          <p className={eyebrowClass}>{actor.compName}</p>
          <h1 className="mt-1 text-title font-bold text-heading">Scoring — {actor.judgeName}</h1>
          <p className="mt-2 text-body text-muted">
            Teams are identified by bid code only. You will not see team names.
          </p>
        </header>

        {locked && (
          <div
            role="status"
            className="mb-6 flex items-center gap-3 rounded-card border border-secondary/30 bg-secondary-light p-4 text-body"
          >
            <LockIcon className="size-4 shrink-0 text-secondary" />
            <span>
              Results were locked at {locked.lockedAt.toLocaleTimeString()}. Scoring is closed.
            </span>
          </div>
        )}

        <div className="space-y-4">
          {teams.map((team, index) => (
            <TeamScoreCard
              key={team.id}
              token={token}
              teamId={team.id}
              bidCode={team.bidCode}
              performanceOrder={team.performanceOrder}
              criteria={rubric.criteria}
              initialValues={Object.fromEntries(scores.get(team.id) ?? [])}
              initialNote={notes.get(team.id) ?? ""}
              locked={locked !== null}
              index={index}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
