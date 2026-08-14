import { notFound, redirect } from "next/navigation";
import { cardClass } from "@/components/styles";
import { recentAudit } from "@/lib/audit/log";
import { compIdBySlugs, describeCompAccess, resolveBoardAccess } from "@/lib/auth/access";
import { boardSnapshot } from "@/lib/comp/board";
import { AuditTrail } from "./AuditTrail";
import { LiveBoard } from "./LiveBoard";
import type { BoardFormScope } from "./state";

export const dynamic = "force-dynamic";

/**
 * A comp's front page, routed by what the visitor is.
 *
 * A board gets the live scoring board. A captain is sent to their own team, because landing them on
 * a `notFound()` for the comp they were invited to is the precise defect P1 shipped and was audited
 * for — the landing page linked all three roles at a page only one of them could open. A liaison is
 * told the truth: the membership is real and the screen is not built.
 *
 * The redirect is deliberate rather than a nav trick: `/app/[org]/[comp]` is the address a person
 * will type, paste and bookmark, and it has to mean *this comp, for me*.
 */
export default async function CompHome({
  params,
}: {
  params: Promise<{ org: string; comp: string }>;
}) {
  const { org, comp } = await params;

  const compId = await compIdBySlugs(org, comp);
  if (!compId) notFound();

  const actor = await resolveBoardAccess(compId);

  if (!actor) {
    const access = await describeCompAccess(compId);
    if (!access) notFound();
    if (access.role === "captain") redirect(`/app/${org}/${comp}/team`);

    return (
      <div className={cardClass} data-testid="no-screen-yet">
        <h2 className="text-card font-semibold text-heading">Nothing here yet</h2>
        <p className="mt-2 text-body text-muted">
          Liaison duties and the schedule they hang off are not built. Your membership at this comp
          is real; there is simply no screen behind it, and saying so is better than sending you to a
          page that would refuse to load.
        </p>
      </div>
    );
  }

  const scope: BoardFormScope = { compId: actor.compId, basePath: `/app/${org}/${comp}` };

  const [snapshot, trail] = await Promise.all([
    boardSnapshot(actor),
    recentAudit(actor.compId, 25),
  ]);

  return <LiveBoard scope={scope} initial={snapshot} trail={<AuditTrail entries={trail} />} />;
}
