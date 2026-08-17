import { notFound, redirect } from "next/navigation";
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

    /**
     * A liaison. This branch used to render a card saying the screen was not built, which was true
     * and is not any more — C1 built it, so the honest thing is the same redirect the captain gets.
     * Every role that can open this comp now lands somewhere it can act, which is what the shell was
     * supposed to guarantee and did not for as long as one role had nowhere to go.
     */
    redirect(`/app/${org}/${comp}/comp-day`);
  }

  const scope: BoardFormScope = { compId: actor.compId, basePath: `/app/${org}/${comp}` };

  const [snapshot, trail] = await Promise.all([
    boardSnapshot(actor),
    recentAudit(actor.compId, 25),
  ]);

  return <LiveBoard scope={scope} initial={snapshot} trail={<AuditTrail entries={trail} />} />;
}
