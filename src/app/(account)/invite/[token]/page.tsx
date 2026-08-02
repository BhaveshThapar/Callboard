import { notFound } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { eyebrowClass } from "@/components/styles";
import { describeInvitation } from "@/lib/auth/accounts";
import { CredentialForm } from "../../CredentialForm";
import { acceptInvitationAction } from "../../actions";

export const dynamic = "force-dynamic";

const ROLE_WORD = {
  board: "a board member",
  captain: "a team captain",
  liaison: "a liaison",
} as const;

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  /**
   * One 404 for expired, spent, revoked and never-existed alike. Distinguishing them tells whoever
   * is holding a dead link whether it was ever real, which is the only thing they could learn here
   * and is not theirs to learn — `publicComp`'s rule about a draft comp, applied to a credential.
   */
  const invitation = await describeInvitation(token);
  if (!invitation) notFound();

  return (
    <div className="bg-app min-h-screen">
      <main className="mx-auto max-w-sm px-4 py-8">
        <Wordmark />

        <header className="mt-10">
          <p className={eyebrowClass}>{invitation.compName}</p>
          <h1 className="mt-1 text-title font-bold text-heading">Set a password</h1>
          <p className="mt-2 text-body text-muted">
            {invitation.invitedByName ? `${invitation.invitedByName} invited you` : "You are invited"}{" "}
            to {invitation.compName} as {ROLE_WORD[invitation.role]}
            {invitation.teamName ? ` for ${invitation.teamName}` : ""}.
          </p>
        </header>

        <CredentialForm
          action={acceptInvitationAction}
          mode="accept"
          email={invitation.email ?? undefined}
          token={token}
          submitLabel="Set password and sign in"
        />

        <p className="mt-6 text-caption text-subtle">
          This invitation is for {invitation.email}. If that is not you, do not use it — ask the
          board to send one to your own address.
        </p>
      </main>
    </div>
  );
}
