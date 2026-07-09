import { notFound } from "next/navigation";
import { recentAudit } from "@/lib/audit/log";
import { resolveBoardActor } from "@/lib/auth/scope";
import { boardSnapshot } from "@/lib/comp/board";
import { AuditTrail } from "./AuditTrail";
import { LiveBoard } from "./LiveBoard";

export const dynamic = "force-dynamic";

export default async function BoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const actor = await resolveBoardActor(token);
  if (!actor) notFound();

  const [snapshot, trail] = await Promise.all([
    boardSnapshot(actor),
    recentAudit(actor.compId, 25),
  ]);

  return <LiveBoard token={token} initial={snapshot} trail={<AuditTrail entries={trail} />} />;
}
