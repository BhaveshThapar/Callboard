import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircleIcon, LockIcon, ShieldIcon, UsersIcon } from "@/components/icons";
import { Wordmark } from "@/components/Wordmark";
import { cardClass, cx, eyebrowClass, primaryButtonClass } from "@/components/styles";
import { compsForSession } from "@/lib/auth/accounts";
import { readSessionCookie } from "@/lib/auth/cookies";
import { listOpenComps } from "@/lib/comp/open";

export const dynamic = "force-dynamic";

const WHAT_IT_DOES = [
  {
    Icon: UsersIcon,
    title: "Registration and money, one record",
    body: "Applications, acceptances and the waitlist join what each team owes. No acceptance doc on one side and a Venmo thread on the other, which is what makes “who has paid” take an afternoon.",
  },
  {
    Icon: ShieldIcon,
    title: "Blind judging, both directions",
    body: "Judges score bid codes, never names. The board sees which judge is slow, never which judge gave what. Neither is a setting somebody can forget to turn on.",
  },
  {
    Icon: LockIcon,
    title: "Results that reproduce",
    body: "Locking freezes the scores, the rubric and the result into one row. A correction appends an attributed re-tabulation; it never edits what was there. The same inputs give the same placements next February.",
  },
];

/**
 * The front door, and the only page in the product with nothing behind it.
 *
 * It used to be a developer note — a card telling a stranger to run `bun run db:seed`, which is a
 * README's job. What a board actually needs from this page is three things: what this is, a way in
 * if they already have an account, and the form if they are a team wanting to apply.
 *
 * **Signed in goes straight to `/app`.** A marketing page is not what somebody with a membership
 * came for, and the dashboard is the page that knows what they are allowed to open. Somebody signed
 * in with no membership at all stays here rather than landing on an empty dashboard, and is told
 * why.
 */
export default async function Home() {
  const session = await readSessionCookie();
  const comps = session ? await compsForSession(session) : [];
  if (comps.length > 0) redirect("/app");

  const open = await listOpenComps();

  return (
    <div className="bg-app min-h-screen">
      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="animate-fade-in-up">
          <Wordmark />
          <h1 className="mt-8 text-metric font-bold leading-tight text-heading">
            The operating system for a collegiate competition weekend.
          </h1>
          <p className="mt-4 text-body leading-relaxed text-muted">
            One record for registration, payments, judging and the run of show — read through a
            different window by everybody who needs one.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/sign-in" className={primaryButtonClass} data-testid="home-sign-in">
              Sign in
            </Link>
            <span className="text-caption text-subtle">
              Board members, captains and liaisons. Accounts come from an invitation.
            </span>
          </div>

          {session && (
            <p className={cx(cardClass, "mt-6")} data-testid="home-no-memberships">
              <span className="text-body text-heading">You are signed in</span>
              <span className="mt-1 block text-caption text-subtle">
                — but you are not on any comp yet. A board adds you; there is no self-serve way onto
                one, because being on a comp is something a board decides.
              </span>
            </p>
          )}
        </div>

        <section
          className={cx(cardClass, "mt-10 animate-fade-in-up")}
          style={{ animationDelay: "0.05s" }}
          data-testid="open-comps"
        >
          <h2 className={eyebrowClass}>Taking applications now</h2>

          {open.length === 0 ? (
            <p className="mt-4 text-body text-muted" data-testid="open-comps-empty">
              No competition is open for applications at the moment. A board opens its own form when
              its season starts.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {open.map((comp) => (
                <li
                  key={`${comp.orgSlug}/${comp.compSlug}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
                  data-testid={`open-comp-${comp.compSlug}`}
                >
                  <div>
                    <Link
                      href={`/c/${comp.orgSlug}/${comp.compSlug}`}
                      className="text-body font-medium text-heading underline underline-offset-2 hover:text-primary"
                    >
                      {comp.compName}
                    </Link>
                    <span className="ml-2 text-caption text-subtle">{comp.orgName}</span>
                    {comp.compDate && (
                      <span className="block text-caption text-subtle">{comp.compDate}</span>
                    )}
                  </div>
                  <Link
                    href={`/register/${comp.orgSlug}/${comp.compSlug}`}
                    className="text-card font-medium text-primary underline underline-offset-2"
                    data-testid={`apply-${comp.compSlug}`}
                  >
                    Apply →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-10 space-y-4">
          {WHAT_IT_DOES.map(({ Icon, title, body }, i) => (
            <div
              key={title}
              className={cx(cardClass, "animate-fade-in-up")}
              style={{ animationDelay: `${0.1 + i * 0.05}s` }}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-light text-primary">
                  <Icon className="size-4" />
                </div>
                <h2 className="text-card font-semibold text-heading">{title}</h2>
              </div>
              <p className="mt-3 text-body leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </section>

        {/*
          Said on the front page rather than left to be discovered, because a judge who cannot find a
          login assumes the product is broken. There is nothing here for them by design (ADR-0003): a
          judge scores once, as a favour, and an account is friction charged to a volunteer.
        */}
        <section
          className={cx(cardClass, "mt-10 animate-fade-in-up")}
          style={{ animationDelay: "0.25s" }}
          data-testid="judges-note"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-light text-primary">
              <CheckCircleIcon className="size-4" />
            </div>
            <h2 className="text-card font-semibold text-heading">Judging today?</h2>
          </div>
          <p className="mt-3 text-body leading-relaxed text-muted">
            There is no account to make and nothing to install. The board sent you a link, and that
            link is your way in — open it on your phone and start scoring.
          </p>
        </section>
      </main>
    </div>
  );
}
