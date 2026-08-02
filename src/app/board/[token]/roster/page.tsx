import Link from "next/link";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { eyebrowClass } from "@/components/styles";
import {
  listRegistrationFieldsForBoard,
  listRosterForBoard,
  resolveBoardActor,
} from "@/lib/auth/scope";
import { registrationWindowFor } from "@/lib/comp/status";
import { latestLockedRun } from "@/lib/comp/tab";
import { RegistrationWindow } from "./RegistrationWindow";
import { RosterTable } from "./RosterTable";

export const dynamic = "force-dynamic";

export default async function RosterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const actor = await resolveBoardActor(token);
  if (!actor) notFound();

  const [roster, locked, fields, window] = await Promise.all([
    listRosterForBoard(actor),
    latestLockedRun(actor.compId),
    listRegistrationFieldsForBoard(actor),
    registrationWindowFor(actor),
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
          <div className="flex items-center gap-4">
            <Link
              href={`/board/${token}/money`}
              data-testid="money-link"
              className="text-caption text-muted underline underline-offset-2 hover:text-primary"
            >
              Who owes what →
            </Link>
            <Link
              href={`/board/${token}/people`}
              data-testid="people-link"
              className="text-caption text-muted underline underline-offset-2 hover:text-primary"
            >
              People →
            </Link>
            <Link
              href={`/board/${token}`}
              className="text-caption text-muted underline underline-offset-2 hover:text-primary"
            >
              Scoring →
            </Link>
          </div>
        </header>

        {window && (
          <RegistrationWindow token={token} status={window.status} publicPath={window.path} />
        )}

        <RosterTable token={token} roster={roster} locked={locked !== null} fields={fields} />
      </main>
    </div>
  );
}
