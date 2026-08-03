import { Wordmark } from "@/components/Wordmark";
import { cardClass } from "@/components/styles";
import { unsubscribe } from "@/lib/comms/subscriptions";

export const dynamic = "force-dynamic";

/**
 * One click, no sign-in, no confirmation step.
 *
 * A person who wants to stop hearing from a comp should not have to prove who they are first — the
 * worst case is somebody unsubscribing a stranger from announcements, which the board can undo and
 * which is a far smaller harm than an unsubscribe link that does not work. Mail clients also expect
 * `List-Unsubscribe-Post` to succeed without a form, and one that renders a button instead gets the
 * sender marked as spam.
 *
 * It suppresses **broadcast only** (ADR-0020). A dues reminder is not silenced by it, and the page
 * says so plainly rather than letting somebody believe they have opted out of being asked for money.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ person: string }>;
}) {
  const { person } = await params;
  const done = await unsubscribe(person);

  return (
    <div className="bg-app min-h-screen">
      <main className="mx-auto max-w-sm px-4 py-8">
        <Wordmark />
        <div className={`${cardClass} mt-10`} data-testid="unsubscribed">
          <h1 className="text-card font-semibold text-heading">
            {done ? "Unsubscribed" : "Nothing to unsubscribe"}
          </h1>
          <p className="mt-2 text-body text-muted">
            {done
              ? "You will not get announcements from this org again."
              : "That link does not match anybody we have."}
          </p>
          <p className="mt-3 text-caption text-subtle">
            Receipts and anything about money you owe still reach you — those are not announcements,
            and a board is entitled to send them.
          </p>
        </div>
      </main>
    </div>
  );
}
