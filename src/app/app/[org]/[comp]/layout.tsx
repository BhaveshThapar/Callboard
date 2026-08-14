import Link from "next/link";
import { notFound } from "next/navigation";
import { RoleBadge } from "@/components/RoleBadge";
import { Wordmark } from "@/components/Wordmark";
import type { AccountRole } from "@/db/schema";
import { compIdBySlugs, describeCompAccess } from "@/lib/auth/access";
import { SignOut } from "../../../(account)/SignOut";
import type { NavItem } from "./CompNav";
import { CompNav } from "./CompNav";

export const dynamic = "force-dynamic";

/**
 * What each role can reach, which is the shell's whole job.
 *
 * A board sees the four screens it runs the comp from. A captain sees one page, their own team, and
 * the absence of the other four is the point: `ownTeamForCaptain` carries no other team, no score
 * and no bid code but its own, and a nav offering *Roster* would be promising something the actor
 * behind it cannot resolve. A liaison has nothing until C1, so their nav is empty rather than
 * pointing at a page that would `notFound()` — which is exactly the defect P1 shipped and was
 * audited for.
 */
const NAV_FOR: Record<AccountRole, (base: string) => NavItem[]> = {
  board: (base) => [
    { href: base, label: "Overview" },
    { href: `${base}/roster`, label: "Roster" },
    { href: `${base}/money`, label: "Money" },
    { href: `${base}/results`, label: "Results" },
    { href: `${base}/people`, label: "People" },
  ],
  captain: (base) => [{ href: `${base}/team`, label: "Team" }],
  liaison: () => [],
};

/**
 * The shell every signed-in screen renders inside.
 *
 * **It authorizes nothing**, and that is deliberate: it reads `describeCompAccess` to know whose
 * name and which tabs to draw, and every page below resolves its own actor through its own
 * resolver. A layout that decided access would become a second definition of who may read what,
 * sitting above the windows that actually enforce it — and the two would drift the first time
 * somebody added a page.
 *
 * What it does guarantee is the negative case: somebody with no standing at this comp gets
 * `notFound()` here rather than a chrome-less page or a flash of a comp name they should not know.
 */
export default async function CompLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string; comp: string }>;
}) {
  const { org, comp } = await params;

  const compId = await compIdBySlugs(org, comp);
  if (!compId) notFound();

  const access = await describeCompAccess(compId);
  if (!access) notFound();

  const base = `/app/${org}/${comp}`;
  const items = NAV_FOR[access.role](base);

  return (
    <div className="bg-app min-h-screen print:bg-white">
      <div className="mx-auto max-w-[1420px] px-4 py-6 sm:px-6 print:max-w-none print:px-0 print:py-0">
        {/* The emcee sheet is printed and read from a music stand (B8). A nav bar and a role badge
            across the top of it is the shell helping itself rather than the person holding it. */}
        <header className="print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Link href={access.signedIn ? "/app" : base}>
              <Wordmark />
            </Link>

            <div className="flex items-center gap-3">
              <span className="text-caption text-subtle" data-testid="whoami">
                {access.personName}
              </span>
              <RoleBadge role={access.role} />
              {/*
                A link is not a session, so there is nothing to sign out of — offering it would
                either do nothing or, worse, look like it revoked the link. Somebody who arrived by
                link is told what they are holding instead.
              */}
              {access.signedIn ? (
                <SignOut />
              ) : (
                <span className="text-caption text-subtle" data-testid="via-link">
                  via board link
                </span>
              )}
            </div>
          </div>

          <h1 className="mt-6 text-title font-bold text-heading" data-testid="comp-name">
            {access.compName}
          </h1>

          {items.length > 0 && <CompNav items={items} />}
        </header>

        <main className="mt-6">{children}</main>
      </div>
    </div>
  );
}
