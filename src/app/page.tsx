import Link from "next/link";
import { ShieldIcon } from "@/components/icons";
import { Wordmark } from "@/components/Wordmark";
import { cardClass, cx, eyebrowClass } from "@/components/styles";
import { compsForSession } from "@/lib/auth/accounts";
import { readSessionCookie } from "@/lib/auth/cookies";
import { SignOut } from "./(account)/SignOut";

export const dynamic = "force-dynamic";

const WHERE = {
  captain: (compId: string) => `/my/${compId}`,
  liaison: (compId: string) => `/my/${compId}`,
  board: (compId: string) => `/my/${compId}`,
} as const;

export default async function Home() {
  /**
   * Where accepting an invitation lands. Without this the journey ends on a marketing page with no
   * way forward, which is the "code with no caller" defect wearing a URL.
   *
   * A board member still works from their emailed link rather than from here — `board_assignments`
   * is what a board token resolves to, and P1 did not migrate those. Until it does, a signed-in
   * board member sees the comp listed and is told where their own way in is.
   */
  const session = await readSessionCookie();
  const comps = session ? await compsForSession(session) : [];

  return (
    <main className="mx-auto max-w-xl px-6 py-20">
      <div className="animate-fade-in-up">
        <Wordmark />
        <h1 className="mt-8 text-metric font-bold text-heading">
          The operating system for a collegiate competition weekend.
        </h1>
      </div>

      {comps.length > 0 && (
        <div className={cx(cardClass, "mt-10")} data-testid="my-comps">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className={eyebrowClass}>Your comps</h2>
            <SignOut />
          </div>
          <ul className="mt-4 space-y-2">
            {comps.map((comp) => (
              <li key={`${comp.compId}-${comp.role}`}>
                <Link
                  href={WHERE[comp.role](comp.compId)}
                  data-testid={`my-comp-${comp.compSlug}`}
                  className="text-body text-heading underline underline-offset-2 hover:text-primary"
                >
                  {comp.compName}
                </Link>
                <span className="ml-2 text-caption text-subtle">as {comp.role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={cx(cardClass, "mt-10 animate-fade-in-up")} style={{ animationDelay: "0.05s" }}>
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-light text-primary">
            <ShieldIcon className="size-4" />
          </div>
          <h2 className={eyebrowClass}>Judge scoring demo</h2>
        </div>

        <p className="mt-4 text-body leading-relaxed text-heading">
          There is no sign-up here. A comp&apos;s board gets one link, and each judge gets their
          own. Run{" "}
          <code className="rounded bg-hover px-1.5 py-0.5 font-mono text-caption">
            bun run db:seed
          </code>{" "}
          to mint them.
        </p>
        <p className="mt-3 text-body leading-relaxed text-muted">
          Judges see anonymized bid codes, never team names. Scores lock into a snapshot that
          reproduces exactly, the next day or the next year.
        </p>
      </div>
    </main>
  );
}
