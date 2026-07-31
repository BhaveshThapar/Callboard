import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { comps, orgs, SCOREABLE_STATUSES, teams } from "@/db/schema";
import { latestLockedRun, reproduce } from "./tab";

export type PublicTeam = { name: string; school: string | null };

export type PublicPlacement = {
  place: number;
  name: string;
  school: string | null;
  deductionPoints: number;
};

export type PublicComp = {
  orgName: string;
  compName: string;
  compDate: string | null;
  venue: string | null;
  /** Whether there is a form to point an applicant at, on exactly `openRegistration`'s terms. */
  registrationOpen: boolean;
  teams: PublicTeam[];
  /** Null until a result is locked. Absent, not empty: nothing has been decided yet. */
  placements: PublicPlacement[] | null;
};

/**
 * The attendee's view (ADJ·3), and the second unauthenticated read in the product after
 * `openRegistration`. It follows the same rule and for the same reason: there is no `Actor` because
 * an attendee is nobody, so the projection *is* the scope, and it is this type. Four things it may
 * not carry, each of which is a leak rather than an omission.
 *
 * **No `bid_code`, anywhere.** Blindness runs one direction — the judge must not see the name — and
 * a judge is a member of the public. Names alone are harmless; the *pairing* is not, and a page
 * carrying both would hand every judge on the panel the mapping ADR-0008 exists to withhold. The
 * field is absent from the return type, so putting it back is a compile error rather than a review
 * someone has to pass, which is how blindness is enforced everywhere else here.
 *
 * **No scores, ever.** PRD B8: publishing the numbers invites a team to litigate a 27-vs-28 on
 * Execution, an argument no board can win. A placement carries its place, its name and its
 * deduction, which is exactly what the team's own feedback export carries.
 *
 * **Only teams that are actually in the comp.** `applied`, `waitlisted` and `dropped` are the
 * board's business: a public page that revealed a team had applied and been turned down is a
 * different product with a different liability.
 *
 * **Placements come from the frozen snapshot, never from `liveStandings`.** A public page showing
 * live standings mid-comp publishes a result no board has stood behind, and would make every
 * refresh a new announcement. They also disappear if the snapshot stops reproducing — a result the
 * product itself cannot verify is not one to publish to an audience.
 *
 * Null for a comp that does not exist, and for a `draft` one, which are one answer to a stranger:
 * saying a comp exists before its board has announced it leaks the timing of the announcement.
 */
export const publicComp = async (
  orgSlug: string,
  compSlug: string,
): Promise<PublicComp | null> => {
  const [row] = await db
    .select({
      compId: comps.id,
      compName: comps.name,
      orgName: orgs.name,
      compDate: comps.compDate,
      venue: comps.venue,
      status: comps.status,
      registration: comps.registration,
    })
    .from(comps)
    .innerJoin(orgs, eq(orgs.id, comps.orgId))
    .where(and(eq(orgs.slug, orgSlug), eq(comps.slug, compSlug)))
    .limit(1);

  if (!row || row.status === "draft") return null;

  const roster = await db
    .select({ id: teams.id, name: teams.name, school: teams.school })
    .from(teams)
    .where(and(eq(teams.compId, row.compId), inArray(teams.status, SCOREABLE_STATUSES)))
    .orderBy(teams.name);

  const locked = await latestLockedRun(row.compId);
  const byId = new Map(roster.map((team) => [team.id, team]));

  return {
    orgName: row.orgName,
    compName: row.compName,
    compDate: row.compDate,
    venue: row.venue,
    registrationOpen: row.status === "open" && row.registration !== null,
    teams: roster.map(({ name, school }) => ({ name, school })),
    placements:
      locked && reproduce(locked).matches
        ? locked.results.placements
            .flatMap((placement) => {
              const team = byId.get(placement.teamId);
              // A placement naming a team the roster no longer carries is dropped rather than
              // rendered as a uuid. The roster freezes at the lock, so this is unreachable today --
              // and it is the shape that stops being unreachable the moment that stops being true.
              return team
                ? [
                    {
                      place: placement.place,
                      name: team.name,
                      school: team.school,
                      deductionPoints: placement.deductionPoints,
                    },
                  ]
                : [];
            })
            .sort((a, b) => a.place - b.place)
        : null,
  };
};
