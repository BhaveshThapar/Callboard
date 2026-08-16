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
 * A membership is not a page, and the three roles land in three different places. Handing all three
 * the same href is precisely the defect P1 shipped and was audited for: the landing page linked
 * every role at `/my/[comp]`, which resolves a *captain* membership by name, so a board member who
 * accepted an invitation and clicked their own comp was told it did not exist.
 *
 * **It returned `string | null` until C1**, because `liaison` had no screen and a card with a
 * sentence was more honest than a link to a `notFound()`. C1 built the screen, so the null branch
 * and the sentence beside it are gone rather than left as an unreachable case — a "no screen yet"
 * message for a role that has one is the shape this repo keeps recording, and the narrowed return
 * type is what stops it coming back by accident.
 */
const destinationFor = (comp: SignedInComp): string => {
  const base = `/app/${comp.orgSlug}/${comp.compSlug}`;
  if (comp.role === "board") return base;
  if (comp.role === "captain") return `${base}/team`;
  return `${base}/comp-day`;
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
                  <Link
                    href={href}
                    className="text-card font-semibold text-heading underline underline-offset-2 hover:text-primary"
                    data-testid={`my-comp-${comp.compSlug}`}
                  >
                    {comp.compName}
                  </Link>
                  <RoleBadge role={comp.role} />
                </div>
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
