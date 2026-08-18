import { cardClass, cx, eyebrowClass } from "@/components/styles";

export type TimelineEntry = {
  kind: string;
  teamName: string | null;
  roomLabel: string | null;
  startsAt: string;
  endsAt: string;
};

const LABEL: Record<string, string> = {
  walk: "Walk",
  lobby: "Lobby",
  stretch: "Stretch",
  props: "Props",
  tech_in: "Tech in",
  tech_out: "Tech out",
  food: "Food",
  judge_cutoff: "Judge cutoff",
  transport: "Transport",
};

/**
 * G4 — one person's re-timed timeline, replacing the ~30-column hand-compiled SATURDAY sheet.
 *
 * A server component and deliberately not a client one: there is nothing to interact with. It is a
 * projection of the same derivation the board reads, filtered to this person before it leaves the
 * server — which is what makes "sees only their own" a property of the query rather than of the
 * markup. `publicComp`'s rule, one window over.
 *
 * The delay banner is the point of the whole phase. PRD §9's complaint is not that the schedule is
 * hard to build, it is that *"every printed and open copy goes silently stale"* — so a page that
 * showed the new times without saying the show had moved would be the same failure with better
 * typography.
 */
export function MyTimeline({
  entries,
  totalDelayMinutes,
  configured,
  empty,
}: {
  entries: TimelineEntry[];
  totalDelayMinutes: number;
  configured: boolean;
  empty: string;
}) {
  if (!configured) {
    return (
      <section className={cx(cardClass, "mt-6")} data-testid="my-timeline">
        <h3 className={eyebrowClass}>Your timings</h3>
        <p className="mt-3 text-body text-muted" data-testid="my-timeline-unconfigured">
          This comp has not published a run of show yet. When it does, your own times appear here.
        </p>
      </section>
    );
  }

  return (
    <section className={cx(cardClass, "mt-6")} data-testid="my-timeline">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={eyebrowClass}>Your timings</h3>
        {totalDelayMinutes !== 0 && (
          <span className="text-caption text-danger" data-testid="my-timeline-delay">
            {totalDelayMinutes > 0
              ? `The show is running ${totalDelayMinutes} minutes behind. These are the new times.`
              : `The show is running ${Math.abs(totalDelayMinutes)} minutes early. These are the new times.`}
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 text-body text-muted" data-testid="my-timeline-empty">
          {empty}
        </p>
      ) : (
        <ol className="mt-4 space-y-1">
          {entries.map((entry, i) => (
            <li
              key={`${entry.kind}-${entry.teamName ?? ""}-${i}`}
              className="flex flex-wrap items-baseline gap-x-3 text-caption"
              data-testid="my-timeline-entry"
            >
              <span className="tabular-nums text-heading">{entry.startsAt}</span>
              <span className="text-muted">{LABEL[entry.kind] ?? entry.kind}</span>
              {entry.teamName && <span className="text-heading">{entry.teamName}</span>}
              {entry.roomLabel && <span className="text-subtle">· {entry.roomLabel}</span>}
              <span className="text-subtle">→ {entry.endsAt}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
