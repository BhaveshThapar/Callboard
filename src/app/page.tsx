import { ShieldIcon } from "@/components/icons";
import { Wordmark } from "@/components/Wordmark";
import { cardClass, cx, eyebrowClass } from "@/components/styles";

export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-6 py-20">
      <div className="animate-fade-in-up">
        <Wordmark />
        <h1 className="mt-8 text-metric font-bold text-heading">
          The operating system for a collegiate competition weekend.
        </h1>
      </div>

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
