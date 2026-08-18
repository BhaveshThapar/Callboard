import { notFound, redirect } from "next/navigation";
import { cardClass } from "@/components/styles";
import type { TeamStatus } from "@/db/schema";
import { PERFORMING_STATUSES } from "@/db/schema";
import { compIdBySlugs, resolveBoardAccess } from "@/lib/auth/access";
import { compsForSession, resolveLiaisonActor } from "@/lib/auth/accounts";
import { readSessionCookie } from "@/lib/auth/cookies";
import { listDutiesForLiaison } from "@/lib/auth/scope";
import { dutiesForComp, listAssignmentsForBoard } from "@/lib/coord/assignments";
import { listInvitationsForBoard } from "@/lib/auth/accounts";
import { listRosterForBoard } from "@/lib/auth/scope";
import { clockAt, scheduleForBoard, scheduleIsLive, timelineForLiaison } from "@/lib/comp/schedule";
import { DutyPanel } from "./DutyPanel";
import { SchedulePanel } from "./SchedulePanel";
import { ShowOrderPanel } from "./ShowOrderPanel";
import { MyDuties } from "./MyDuties";
import { MyTimeline } from "./MyTimeline";

export const dynamic = "force-dynamic";

/**
 * Comp day — who is doing what, and when.
 *
 * **One screen, two roles, and that is why the board nav holds at six tabs.** A board assigns duties
 * here; a liaison reads their own and says they have them. Splitting them into `/duties` and
 * `/schedule` would have taken the board to seven tabs on a Pixel 7, and P4's own argument is that
 * ad-hoc navigation is how A9's dashboard shipped reachable only by typing its URL. When the Gita
 * lands, its timeline belongs on this page too: a person's duties and their timings are one
 * question, which is what G4 says out loud.
 *
 * The branch is on **which actor resolves**, never on a role read off the URL. A board goes through
 * `resolveBoardAccess`, which takes a session or a board link and cannot tell you which; a liaison
 * goes through the account path `team/page.tsx` established — cookie, comp id, resolver. There is
 * deliberately no `resolveLiaisonAccess` in `lib/auth`: one more function there taking no `Actor` is
 * the shape somebody flags on review, and the page can ask for itself.
 */
export default async function CompDayPage({
  params,
}: {
  params: Promise<{ org: string; comp: string }>;
}) {
  const { org, comp } = await params;
  const base = `/app/${org}/${comp}`;
  const here = `${base}/comp-day`;

  const compId = await compIdBySlugs(org, comp);
  if (!compId) notFound();

  const board = await resolveBoardAccess(compId);
  if (board) {
    const [duties, assigned, people, roster, schedule, live] = await Promise.all([
      dutiesForComp(compId),
      listAssignmentsForBoard(board),
      listInvitationsForBoard(board),
      listRosterForBoard(board),
      scheduleForBoard(board),
      scheduleIsLive(compId),
    ]);

    const clock = (minute: number): string =>
      schedule.config ? clockAt(schedule.config, minute) : String(minute);

    return (
      <div className="max-w-5xl">
        <header className="mb-6">
          <h2 className="text-card font-semibold text-heading">Comp day</h2>
          <p className="text-caption text-subtle mt-1">
            Who is doing what, and when. A person has to be on this comp before they can be given a
            duty — invite them on the People screen first.
          </p>
        </header>

        <DutyPanel
          compId={compId}
          basePath={base}
          duties={duties ?? []}
          assignments={assigned}
          /*
           * Invited, not necessarily signed in. A board plans comp day in the weeks before it, so
           * requiring somebody to have accepted first would mean the duty list could not be built
           * until the last volunteer logged in — backwards, and stricter than `assignDutyAction`,
           * which only asks that the person be on this comp. `revoked` is the one that filters:
           * somebody a board has removed should not be handed new work.
           *
           * `pending` is carried through so the screen can say which is which. A board assigning a
           * duty to somebody who has not accepted yet needs to know that, because the person will
           * not see it until they do.
           */
          people={people
            .filter((p) => !p.revokedAt)
            .map((p) => ({
              personId: p.personId,
              name: p.name,
              pending: !p.acceptedAt,
            }))}
          teams={roster.map((t) => ({ id: t.id, name: t.name }))}
        />

        <ShowOrderPanel
          compId={compId}
          basePath={base}
          /*
           * The draw is over the teams that take the stage, `PERFORMING_STATUSES` -- not the whole
           * roster. An applicant and a waitlisted team have no slot, and a dropped team's slot is a
           * hole the board closes by renumbering.
           */
          rows={roster
            .filter((t) => (PERFORMING_STATUSES as readonly TeamStatus[]).includes(t.status))
            .map((t) => ({
              id: t.id,
              name: t.name,
              bidCode: t.bidCode,
              position: t.performanceOrder,
            }))}
        />

        <SchedulePanel
          compId={compId}
          basePath={base}
          configured={schedule.config !== null}
          live={live}
          timeline={(schedule.result?.segments ?? []).map((segment) => ({
            kind: segment.kind,
            ref: segment.ref,
            teamName: segment.teamId ? (schedule.names[segment.teamId] ?? null) : null,
            room:
              schedule.config?.rooms.find((room) => room.id === segment.room)?.label ?? segment.room,
            startsAt: clock(segment.startsAtMinute),
            endsAt: clock(segment.endsAtMinute),
          }))}
          slack={(schedule.result?.slack ?? []).map((pool) => ({
            ...pool,
            exhausted: (schedule.result?.exhausted ?? []).includes(pool.id),
          }))}
          gaps={(schedule.result?.gaps ?? []).map((gap) => ({
            kind: gap.kind,
            teamName: gap.teamId ? (schedule.names[gap.teamId] ?? null) : null,
            missing: gap.missing,
          }))}
          delays={schedule.delays.map(({ seq, minutes, fromPosition, reason }) => ({
            seq,
            minutes,
            fromPosition,
            reason,
          }))}
          totalDelayMinutes={schedule.result?.totalDelayMinutes ?? 0}
          unabsorbedMinutes={schedule.result?.unabsorbedMinutes ?? 0}
          maxPosition={roster.reduce((max, team) => Math.max(max, team.performanceOrder ?? 0), 0)}
        />
      </div>
    );
  }

  const session = await readSessionCookie();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(here)}`);

  const liaison = await resolveLiaisonActor(session, compId);
  if (!liaison) {
    // Some other membership at this comp: the dashboard is where it says what that role can open.
    // Telling a signed-in person their own comp does not exist is the lie `team/page.tsx` told for
    // a day, and it is not repeated here.
    const held = await compsForSession(session);
    if (held.some((row) => row.compId === compId)) redirect("/app");
    notFound();
  }

  const [mine, duties, timeline] = await Promise.all([
    listDutiesForLiaison(liaison),
    dutiesForComp(compId),
    timelineForLiaison(liaison),
  ]);

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h2 className="text-card font-semibold text-heading">Your duties</h2>
        <p className="text-caption text-subtle mt-1">
          What the board has asked you to do at {liaison.compName}.
        </p>
      </header>

      {mine.length === 0 ? (
        <div className={cardClass} data-testid="no-duties">
          <p className="text-body text-subtle">
            Nothing yet. The board has not assigned you a duty for this comp.
          </p>
        </div>
      ) : (
        <MyDuties compId={compId} basePath={base} duties={duties ?? []} mine={mine} />
      )}

      <MyTimeline
        configured={timeline.config !== null}
        totalDelayMinutes={timeline.totalDelayMinutes}
        empty="Nothing on the run of show is yours yet. A duty about one team puts that team's walk and stretch here."
        entries={timeline.segments.map((segment) => ({
          kind: segment.kind,
          teamName: segment.teamName,
          roomLabel: segment.roomLabel,
          startsAt: timeline.config ? clockAt(timeline.config, segment.startsAtMinute) : "",
          endsAt: timeline.config ? clockAt(timeline.config, segment.endsAtMinute) : "",
        }))}
      />
    </div>
  );
}
