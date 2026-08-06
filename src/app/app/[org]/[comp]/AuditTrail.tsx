import { cx } from "@/components/styles";
import type { recentAudit } from "@/lib/audit/log";

type AuditRow = Awaited<ReturnType<typeof recentAudit>>[number];

/**
 * Total over `ACTOR_KINDS`, so a new kind of actor is a type error here rather than a blank badge in
 * an audit trail. That is why the union is a `Record` and not a lookup with a fallback.
 */
const ACTOR_INITIAL: Record<AuditRow["actorKind"], string> = {
  board: "B",
  judge: "J",
  team: "T",
  liaison: "L",
  system: "S",
};

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

export function AuditTrail({ entries }: { entries: AuditRow[] }) {
  return (
    <section className="rounded-card border border-border bg-surface shadow-card">
      <header className="border-b border-border-soft p-5">
        <h2 className="text-card font-semibold text-heading">Audit trail</h2>
        <p className="mt-1 text-caption text-muted">
          Every score, deduction, and lock, in order. This is what paper cannot give you.
        </p>
      </header>

      <ol className="max-h-[60vh] space-y-3 overflow-y-auto p-5">
        {entries.map((entry, index) => (
          <li
            key={entry.id}
            className="flex animate-slide-in gap-2.5"
            style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }}
          >
            <div
              className={cx(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-micro font-bold",
                entry.actorKind === "board"
                  ? "bg-primary text-on-primary"
                  : "bg-hover text-muted",
              )}
              aria-hidden
            >
              {entry.actorName ? initialsOf(entry.actorName) : ACTOR_INITIAL[entry.actorKind]}
            </div>

            <div
              className={cx(
                "min-w-0 flex-1 rounded-lg px-3 py-2",
                entry.actorKind === "board"
                  ? "bg-primary-light/70"
                  : "border border-border-soft bg-surface",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-caption font-medium text-heading">
                  {entry.action}
                </span>
                <time className="tabular shrink-0 text-micro text-subtle">
                  {entry.at.toLocaleTimeString()}
                </time>
              </div>
              <p className="mt-0.5 text-micro tracking-wide text-subtle">
                <span className="font-medium text-muted">{entry.actorName ?? entry.actorKind}</span>
                <span className="uppercase"> · {entry.entity}</span>
              </p>
            </div>
          </li>
        ))}

        {entries.length === 0 && (
          <li className="py-8 text-center text-body text-subtle">Nothing has happened yet.</li>
        )}
      </ol>
    </section>
  );
}
