import { notFound } from "next/navigation";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { cardClass, eyebrowClass } from "@/components/styles";
import { publicComp } from "@/lib/comp/public";

export const dynamic = "force-dynamic";

/**
 * The deployment is a sales demo seeded with real org and team names, so the root layout tells
 * crawlers to stay out and this page does not override it. Flip it here, and only here, once this
 * runs against a comp whose board has asked to be found.
 */

export default async function PublicCompPage({
  params,
}: {
  params: Promise<{ org: string; comp: string }>;
}) {
  const { org, comp } = await params;

  const info = await publicComp(org, comp);
  if (!info) notFound();

  const when =
    info.compDate &&
    new Date(`${info.compDate}T00:00:00`).toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

  return (
    <div className="bg-app min-h-screen">
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Wordmark />

        <header className="mt-8 mb-6">
          <p className={eyebrowClass}>{info.orgName}</p>
          <h1 className="mt-1 text-title font-bold text-heading">{info.compName}</h1>
          <p className="mt-2 text-body text-muted">{[when, info.venue].filter(Boolean).join(" · ")}</p>
        </header>

        {info.registrationOpen && (
          <div className={cardClass} data-testid="public-register">
            <h2 className="text-card font-semibold text-heading">Registration is open</h2>
            <p className="mt-1 text-caption text-muted">
              Applying does not accept your team. The board reviews every application.
            </p>
            <Link
              href={`/register/${org}/${comp}`}
              className="mt-3 inline-block text-body text-primary underline-offset-2 hover:underline"
            >
              Apply to compete →
            </Link>
          </div>
        )}

        {info.placements && (
          <section className="mt-6" data-testid="public-placements">
            <h2 className={eyebrowClass}>Final placements</h2>
            <ol className={`${cardClass} mt-2 space-y-1`}>
              {info.placements.map((placement) => (
                <li
                  key={`${placement.place}-${placement.name}`}
                  className="flex items-baseline gap-4 border-b border-border-soft py-2 last:border-0"
                >
                  <span className="tabular w-6 shrink-0 text-card font-bold text-heading">
                    {placement.place}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-heading">{placement.name}</span>
                    {placement.school && (
                      <span className="ml-2 text-caption text-muted">{placement.school}</span>
                    )}
                  </span>
                  {placement.deductionPoints > 0 && (
                    <span className="tabular shrink-0 text-caption font-semibold text-secondary">
                      −{placement.deductionPoints}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="mt-6" data-testid="public-teams">
          <h2 className={eyebrowClass}>{info.placements ? "Who competed" : "Who is competing"}</h2>
          {info.teams.length === 0 ? (
            <p className="mt-2 text-body text-muted">The lineup has not been announced yet.</p>
          ) : (
            <ul className={`${cardClass} mt-2 space-y-1`}>
              {info.teams.map((team) => (
                <li
                  key={team.name}
                  className="border-b border-border-soft py-2 last:border-0 text-body"
                >
                  <span className="font-medium text-heading">{team.name}</span>
                  {team.school && <span className="ml-2 text-caption text-muted">{team.school}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-10 text-micro text-subtle">Run on Callboard.</footer>
      </main>
    </div>
  );
}
