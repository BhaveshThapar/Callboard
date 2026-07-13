import { notFound } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { eyebrowClass } from "@/components/styles";
import { openRegistration } from "@/lib/comp/registration";
import { RegistrationForm } from "./RegistrationForm";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ org: string; comp: string }>;
}) {
  const { org, comp } = await params;

  // Null covers both "no form" and "not open yet". A stranger gets the same 404 for each: telling
  // them a comp exists but has not opened leaks the timing of a comp the board has not announced.
  const open = await openRegistration(org, comp);
  if (!open) notFound();

  return (
    <div className="bg-app min-h-screen">
      <main className="mx-auto max-w-lg px-4 py-8">
        <Wordmark />

        <header className="mt-8 mb-6">
          <p className={eyebrowClass}>{open.orgName}</p>
          <h1 className="mt-1 text-title font-bold text-heading">{open.compName}</h1>
          <p className="mt-2 text-body text-muted">
            {[
              open.compDate &&
                new Date(`${open.compDate}T00:00:00`).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                }),
              open.venue,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </header>

        <RegistrationForm open={open} orgSlug={org} compSlug={comp} />
      </main>
    </div>
  );
}
