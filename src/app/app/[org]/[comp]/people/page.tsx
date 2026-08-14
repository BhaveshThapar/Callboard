import { notFound } from "next/navigation";
import type { BoardFormScope } from "../state";
import { eyebrowClass } from "@/components/styles";
import { listInvitationsForBoard } from "@/lib/auth/accounts";
import { listRosterForBoard } from "@/lib/auth/scope";
import { resolveBoardAccessBySlugs } from "@/lib/auth/access";
import { InvitePanel } from "./InvitePanel";
import type { InviteeRow } from "./InvitePanel";

export const dynamic = "force-dynamic";

export default async function PeoplePage({ params }: { params: Promise<{ org: string; comp: string }> }) {
  const { org, comp } = await params;

  const actor = await resolveBoardAccessBySlugs(org, comp);
  if (!actor) notFound();

  const scope: BoardFormScope = { compId: actor.compId, basePath: `/app/${org}/${comp}` };

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
    hasAccess: row.hasAccess,
  }));

  return (
    <>
      <div className="max-w-3xl">
        <h2 className={eyebrowClass}>People</h2>

        <InvitePanel
          scope={scope}
          invitees={invitees}
          teams={roster.map((team) => ({ id: team.id, name: team.name, bidCode: team.bidCode }))}
        />
      </div>
    </>
  );
}
