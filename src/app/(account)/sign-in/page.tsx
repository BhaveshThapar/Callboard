import { Wordmark } from "@/components/Wordmark";
import { CredentialForm } from "../CredentialForm";
import { signInAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="bg-app min-h-screen">
      <main className="mx-auto max-w-sm px-4 py-8">
        <Wordmark />

        <header className="mt-10">
          <h1 className="text-title font-bold text-heading">Sign in</h1>
          <p className="mt-2 text-body text-muted">
            For board members, team captains and liaisons.{" "}
            <span className="text-heading">Judges do not sign in</span> — a judge scores from the
            link they were sent.
          </p>
        </header>

        <CredentialForm action={signInAction} mode="sign-in" next={next} submitLabel="Sign in" />

        <p className="mt-6 text-caption text-subtle">
          No password yet? An account is created by accepting an invitation from your board — there
          is no self-serve signup, because being on a comp is something a board decides.
        </p>
      </main>
    </div>
  );
}
