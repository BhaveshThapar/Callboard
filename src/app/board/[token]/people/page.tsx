import Link from "next/link";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { eyebrowClass } from "@/components/styles";
import { listInvitationsForBoard } from "@/lib/auth/accounts";
import { listRosterForBoard, resolveBoardActor } from "@/lib/auth/scope";
import { InvitePanel } from "./InvitePanel";
import type { InviteeRow } from "./InvitePanel";

export const dynamic = "force-dynamic";

export default async function PeoplePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const actor = await resolveBoardActor(token);
  if (!actor) notFound();

  const [invitations, roster] = await Promise.all([
    listInvitationsForBoard(actor),
    listRosterForBoard(actor),
  ]);

  const now = Date.now();
  const invitees: InviteeRow[] = invitations.map((row) => ({
    personId: row.personId,
    name: row.name,
    email: row.email,
    role: row.role,
    teamName: row.teamName,
    accepted: row.acceptedAt !== null,
    revoked: row.revokedAt !== null,
    expired: row.acceptedAt === null && row.expiresAt.getTime() <= now,
  }));

  return (
    <div className="bg-app min-h-screen">
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Wordmark />

        <header className="mt-8 mb-6 flex items-end justify-between gap-4">
          <div>
            <p className={eyebrowClass}>{actor.compName}</p>
            <h1 className="mt-1 text-title font-bold text-heading">People</h1>
          </div>
          <Link
            href={`/board/${token}`}
            className="text-caption text-muted underline underline-offset-2 hover:text-primary"
          >
            Scoring →
          </Link>
        </header>

        <InvitePanel
          token={token}
          invitees={invitees}
          teams={roster.map((team) => ({ id: team.id, name: team.name, bidCode: team.bidCode }))}
        />
      </main>
    </div>
  );
}
