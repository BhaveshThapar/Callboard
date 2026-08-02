import { notFound, redirect } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { cardClass, cx, eyebrowClass, pillClass } from "@/components/styles";
import { compsForSession, resolveTeamActor } from "@/lib/auth/accounts";
import { readSessionCookie } from "@/lib/auth/cookies";
import { ownTeamForCaptain } from "@/lib/auth/scope";
import { describeBalance, formatCents } from "@/lib/money/format";
import { SignOut } from "../../SignOut";

export const dynamic = "force-dynamic";

/**
 * What a captain sees: their own team, and no other.
 *
 * A4's first half. The page holds no `teamId` and takes none from the URL — the comp is in the path
 * and the team comes off the actor's membership, so there is no id here that could be swapped for
 * somebody else's. That is the whole reason `ownTeamForCaptain` was allowed to be a fourth window.
 */
export default async function MyTeamPage({ params }: { params: Promise<{ comp: string }> }) {
  const { comp } = await params;

  const session = await readSessionCookie();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/my/${comp}`)}`);

  const actor = await resolveTeamActor(session, comp);
  if (!actor) {
    // Not a captain here. If this session holds some *other* membership at this comp, the landing
    // page is where it says what that role can and cannot open, so send them there rather than
    // 404ing: telling a signed-in board member their own comp does not exist is a lie, and it is
    // the one this page told for as long as the landing page linked all three roles at it.
    const held = await compsForSession(session);
    if (held.some((row) => row.compId === comp)) redirect("/");
    notFound();
  }

  const team = await ownTeamForCaptain(actor);
  if (!team) notFound();

  return (
    <div className="bg-app min-h-screen">
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Wordmark />

        <header className="mt-8 mb-6 flex items-end justify-between gap-4">
          <div>
            <p className={eyebrowClass}>{actor.compName}</p>
            <h1 className="mt-1 text-title font-bold text-heading">{team.name}</h1>
            <p className="mt-1 text-caption text-subtle">
              {team.school ? `${team.school} · ` : ""}
              {team.bidCode}
            </p>
          </div>
          <SignOut />
        </header>

        <div className={cardClass} data-testid="my-team">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-card font-semibold text-heading">What you owe</h2>
            <span
              data-testid="my-balance"
              data-balance-cents={team.balance.balanceCents}
              className={cx(
                pillClass,
                team.balance.balanceCents > 0
                  ? "bg-danger-light text-danger"
                  : "bg-primary-light text-primary",
              )}
            >
              {describeBalance(team.balance.balanceCents)}
            </span>
          </div>

          {team.charges.length === 0 ? (
            <p className="mt-3 text-body text-muted" data-testid="my-nothing-billed">
              Nothing has been billed to you yet.
            </p>
          ) : (
            <table className="mt-4 w-full text-body">
              <tbody>
                {team.charges.map((charge) => (
                  <tr
                    key={charge.id}
                    data-testid={`my-charge-${charge.kind}`}
                    data-paid-cents={charge.paidCents}
                    className="border-b border-border-soft/60"
                  >
                    <td className="py-2.5 pr-3 text-heading">{charge.kind.replace("_", " ")}</td>
                    <td className="tabular py-2.5 pr-3 text-right text-muted">
                      {formatCents(charge.amountCents)}
                    </td>
                    <td className="tabular py-2.5 text-right text-subtle">
                      {charge.paidCents === 0
                        ? "unpaid"
                        : charge.paidCents >= charge.amountCents
                          ? "paid"
                          : `${formatCents(charge.paidCents)} paid`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* No rail, no card form, no "pay now". The ledger records money on a rail it does not
              route (PAYMENTS.md), so telling a captain how to pay is the board's job and pretending
              otherwise here would be the first line of a Stripe integration nobody asked for. */}
          <p className="mt-4 text-caption text-subtle">
            Pay however your board asked you to. What arrives is recorded here.
          </p>
        </div>

        <p className="mt-6 text-caption text-subtle">
          Signed in as {actor.personName}. You can see your own team and nothing else about the comp.
        </p>
      </main>
    </div>
  );
}
