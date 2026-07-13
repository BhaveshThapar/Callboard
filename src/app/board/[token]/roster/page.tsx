import Link from "next/link";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { eyebrowClass } from "@/components/styles";
import { listRosterForBoard, resolveBoardActor } from "@/lib/auth/scope";
import { latestLockedRun } from "@/lib/comp/tab";
import { RosterTable } from "./RosterTable";

export const dynamic = "force-dynamic";

export default async function RosterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const actor = await resolveBoardActor(token);
  if (!actor) notFound();

  const [roster, locked] = await Promise.all([
    listRosterForBoard(actor),
    latestLockedRun(actor.compId),
  ]);

  return (
    <div className="bg-app min-h-screen">
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Wordmark />

        <header className="mt-8 mb-6 flex items-end justify-between gap-4">
          <div>
            <p className={eyebrowClass}>{actor.compName}</p>
            <h1 className="mt-1 text-title font-bold text-heading">Registration</h1>
          </div>
          <Link
            href={`/board/${token}`}
            className="text-caption text-muted underline underline-offset-2 hover:text-primary"
          >
            Scoring →
          </Link>
        </header>

        <RosterTable token={token} roster={roster} locked={locked !== null} />
      </main>
    </div>
  );
}
