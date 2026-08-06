import { notFound } from "next/navigation";
import type { BoardFormScope } from "../state";
import { eyebrowClass } from "@/components/styles";
import { listRegistrationFieldsForBoard, listRosterForBoard } from "@/lib/auth/scope";
import { resolveBoardAccessBySlugs } from "@/lib/auth/access";
import { ANNOUNCEABLE_STATUSES } from "@/db/schema/teams";
import { registrationWindowFor } from "@/lib/comp/status";
import { latestLockedRun } from "@/lib/comp/tab";
import { Announce } from "./Announce";
import { RegistrationWindow } from "./RegistrationWindow";
import { RosterTable } from "./RosterTable";

export const dynamic = "force-dynamic";

const ANNOUNCEABLE: readonly string[] = ANNOUNCEABLE_STATUSES;

export default async function RosterPage({ params }: { params: Promise<{ org: string; comp: string }> }) {
  const { org, comp } = await params;

  const actor = await resolveBoardAccessBySlugs(org, comp);
  if (!actor) notFound();

  const scope: BoardFormScope = { compId: actor.compId, basePath: `/app/${org}/${comp}` };

  const [roster, locked, fields, window] = await Promise.all([
    listRosterForBoard(actor),
    latestLockedRun(actor.compId),
    listRegistrationFieldsForBoard(actor),
    registrationWindowFor(actor),
  ]);

  return (
    <>
      <div className="max-w-4xl">
        <h2 className={eyebrowClass}>Registration</h2>

        {window && (
          <RegistrationWindow scope={scope} status={window.status} publicPath={window.path} />
        )}

        <RosterTable scope={scope} roster={roster} locked={locked !== null} fields={fields} />

        {/* Below the roster, because the roster is the audience: the count here and the teams
            above it are the same read, so the button cannot promise more than it reaches. */}
        <div className="mt-6">
          <Announce
            scope={scope}
            audience={roster.filter((team) => ANNOUNCEABLE.includes(team.status)).length}
          />
        </div>
      </div>
    </>
  );
}
