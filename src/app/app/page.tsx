import Link from "next/link";
import { redirect } from "next/navigation";
import { RoleBadge } from "@/components/RoleBadge";
import { Wordmark } from "@/components/Wordmark";
import { cardClass, cx, eyebrowClass } from "@/components/styles";
import type { SignedInComp } from "@/lib/auth/accounts";
import { compsForSession } from "@/lib/auth/accounts";
import { readSessionCookie } from "@/lib/auth/cookies";
import { SignOut } from "../(account)/SignOut";

export const dynamic = "force-dynamic";

/**
 * Where a role actually goes, and the reason this is a function rather than one link.
 *
 * A membership is not a page. `board` and `captain` each have somewhere to land; `liaison` is a real
 * role with a real actor and **no screen** until C1 builds one, so it gets a sentence instead of a
 * link. Handing all three the same href is precisely the defect P1 shipped and was audited for: the
 * landing page linked every role at `/my/[comp]`, which resolves a *captain* membership by name, so
 * a board member who accepted an invitation and clicked their own comp was told it did not exist.
 */
const destinationFor = (comp: SignedInComp): string | null => {
  const base = `/app/${comp.orgSlug}/${comp.compSlug}`;
  if (comp.role === "board") return base;
  if (comp.role === "captain") return `${base}/team`;
  return null;
};

const NO_SCREEN_YET: Record<string, string> = {
  liaison:
    "Liaison duties and the schedule they hang off are not built yet, so there is nothing here to open. Your membership is real; the screen is not.",
};

/**
 * The dashboard — every comp this session may open, and nothing else.
 *
 * It reads `compsForSession`, which resolves no row *in* a comp: it answers which comps the holder
 * has a live membership at, which is a different question from any of the three windows and needs no
 * `Actor`. A revoked membership disappears here on the next request, because the same `revoked_at`
 * filter that governs authority governs this list.
 */
export default async function Dashboard() {
  const session = await readSessionCookie();
  if (!session) redirect("/sign-in?next=/app");

  const comps = await compsForSession(session);
  if (comps.length === 0) redirect("/");

  return (
    <div className="bg-app min-h-screen">
      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex items-center justify-between gap-4">
          <Link href="/">
            <Wordmark />
          </Link>
          <SignOut />
        </div>

        <header className="mt-10">
          <h1 className="text-title font-bold text-heading">Your comps</h1>
          <p className="mt-2 text-body text-muted">
            What you can open depends on what your board made you at each one.
          </p>
        </header>

        <ul className="mt-6 space-y-3" data-testid="my-comps">
          {comps.map((comp) => {
            const href = destinationFor(comp);

            return (
              <li key={`${comp.compId}-${comp.role}`} className={cardClass}>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  {/*
                    The testid rides the *link*, not the row. It named the row for one commit and
                    `getByTestId(...).click()` then clicked a `<li>` — no navigation, no error, a
                    test failing three assertions later about a page it never left. What a caller
                    means by "my comp here" is the thing that opens it.
                  */}
                  {href ? (
                    <Link
                      href={href}
                      className="text-card font-semibold text-heading underline underline-offset-2 hover:text-primary"
                      data-testid={`my-comp-${comp.compSlug}`}
                    >
                      {comp.compName}
                    </Link>
                  ) : (
                    <span
                      className="text-card font-semibold text-heading"
                      data-testid={`my-comp-${comp.compSlug}`}
                    >
                      {comp.compName}
                    </span>
                  )}
                  <RoleBadge role={comp.role} />
                </div>

                {!href && (
                  <p
                    className="mt-2 text-caption text-subtle"
                    data-testid={`my-comp-${comp.compSlug}-note`}
                  >
                    {NO_SCREEN_YET[comp.role]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <p className={cx(eyebrowClass, "mt-8")}>
          Judges do not appear here — a judge scores from the link they were sent.
        </p>
      </main>
    </div>
  );
}
