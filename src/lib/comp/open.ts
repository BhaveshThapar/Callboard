import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { comps, orgs } from "@/db/schema";

/**
 * What a stranger on the front page may know about a comp: that it exists, who runs it, when it is,
 * and that its form is open.
 *
 * **The projection is the scope.** This is the third `Actor`-less read in the product, and it is
 * governed by the rule the other two are: `openRegistration` selects no team, no score and no
 * person, and `publicComp` additionally selects no `bid_code`. CLAUDE.md's own sentence about adding
 * one of these is *"adding a third public read means adding a third projection, not relaxing one of
 * these two"* — so this is a new type rather than a new argument to an existing read, and putting a
 * field back is a compile error rather than a review somebody has to pass.
 *
 * There is no team here and no count of teams. How many have applied is a fact about a board's
 * season that a rival board can read off a public page, and nobody asked for it.
 */
export type OpenComp = {
  orgSlug: string;
  orgName: string;
  compSlug: string;
  compName: string;
  compDate: string | null;
};

/**
 * Every comp currently taking applications, soonest first.
 *
 * `status = 'open'` and nothing else, which is the same predicate `openRegistration` gates the form
 * on — so a comp listed here always has a form that will accept, and one that closed disappears from
 * the front page in the same act that closes it. `draft` is invisible for `publicComp`'s reason:
 * saying a comp exists before its board has announced it leaks the timing of the announcement.
 */
export const listOpenComps = async (): Promise<OpenComp[]> =>
  db
    .select({
      orgSlug: orgs.slug,
      orgName: orgs.name,
      compSlug: comps.slug,
      compName: comps.name,
      compDate: comps.compDate,
    })
    .from(comps)
    .innerJoin(orgs, eq(orgs.id, comps.orgId))
    .where(eq(comps.status, "open"))
    .orderBy(asc(comps.compDate), asc(comps.name));
