/**
 * A6 — what a team owes, as a function of the schedule and the roster.
 *
 * Pure, and fenced by ESLint rather than by this comment (`pureZone` in eslint.config.mjs, the same
 * helper that fences `src/lib/tabulation/`). `asOf` is passed in because `lateAfter` is a date, and
 * a module that read the clock would bill a different number on Tuesday than on Monday — exactly
 * the class of thing a treasurer can neither argue with nor check.
 *
 * The database side is `src/lib/money/charges.ts`, split from this the way `src/lib/comp/tab.ts` is
 * split from `src/lib/tabulation/`.
 */
import type {
  BillingGap,
  ChargeKind,
  ChargeLine,
  ChargePlan,
  ExistingCharge,
  FeeInput,
} from "./types";

const identity = (teamId: string, kind: ChargeKind): string => `${teamId} ${kind}`;

/**
 * What the schedule says each team owes, plus what it could not say and why.
 *
 * A zero-valued component produces no line at all: a comp with `depositCents: 0` does not charge a
 * $0 deposit, it does not charge a deposit. That is the difference between a schedule that is
 * silent and one that is generous, and only the first is true.
 */
export const generateCharges = (input: FeeInput): { lines: ChargeLine[]; gaps: BillingGap[] } => {
  const { schedule, teams, asOf } = input;
  const lines: ChargeLine[] = [];
  const gaps: BillingGap[] = [];

  const lateApplies =
    schedule.lateFeeCents > 0 && schedule.lateAfter !== null && asOf > schedule.lateAfter;

  for (const team of teams) {
    if (schedule.perDancerCents > 0) {
      if (team.rosterSize === null) {
        gaps.push({ teamId: team.teamId, kind: "registration", missing: "rosterSize" });
      } else if (team.rosterSize > 0) {
        lines.push({
          teamId: team.teamId,
          kind: "registration",
          amountCents: schedule.perDancerCents * team.rosterSize,
        });
      }
    }

    if (schedule.perRoomCents > 0) {
      if (team.rooms === null) {
        gaps.push({ teamId: team.teamId, kind: "hotel", missing: "rooms" });
      } else if (team.rooms > 0) {
        lines.push({
          teamId: team.teamId,
          kind: "hotel",
          amountCents: schedule.perRoomCents * team.rooms,
        });
      }
    }

    if (schedule.depositCents > 0) {
      lines.push({ teamId: team.teamId, kind: "deposit", amountCents: schedule.depositCents });
    }

    if (lateApplies) {
      lines.push({ teamId: team.teamId, kind: "late_fee", amountCents: schedule.lateFeeCents });
    }
  }

  return { lines, gaps };
};

/**
 * The difference between what the schedule says and what the database holds.
 *
 * Pure, so its test needs no database — which matters, because idempotency is the property that
 * makes regeneration safe to run on every acceptance, and a property tested only through a database
 * is one tested only in the cases somebody thought to seed.
 *
 * Identity is `(teamId, kind)` among live charges, matching `charges_live_kind_unique` by
 * construction rather than by agreement. Three rules and no fourth:
 *
 * - the schedule still says it, at the same amount → **unchanged**. Regenerating twice with no
 *   roster change is `{insert: [], void: []}`, and that is the whole idempotency claim.
 * - the schedule says it at a *different* amount → **void the old, insert the new**. Never an
 *   update: the old row keeps its allocations, so what was already paid stays attached to the
 *   obligation it was paid against.
 * - the schedule no longer says it → **void**. This is what a drop triggers, and it is what stops
 *   a dropped team's obligations from outliving it.
 *
 * A voided charge is never resurrected: it is not in `existing`, so it cannot be matched, and the
 * partial index does not block the new insert. That is what makes a team which paid, dropped and
 * came back read *paid, not owing* — its old allocations still count.
 */
export const planCharges = (
  generated: readonly ChargeLine[],
  existing: readonly ExistingCharge[],
): ChargePlan => {
  const byIdentity = new Map(existing.map((charge) => [identity(charge.teamId, charge.kind), charge]));
  const seen = new Set<string>();
  const plan: ChargePlan = { insert: [], void: [], unchanged: [] };

  for (const line of generated) {
    const key = identity(line.teamId, line.kind);
    seen.add(key);
    const current = byIdentity.get(key);

    if (!current) {
      plan.insert.push(line);
    } else if (current.amountCents === line.amountCents) {
      plan.unchanged.push(current);
    } else {
      plan.void.push(current);
      plan.insert.push(line);
    }
  }

  for (const charge of existing) {
    if (!seen.has(identity(charge.teamId, charge.kind))) plan.void.push(charge);
  }

  return plan;
};

/** What a set of charges comes to. One place, so no caller writes the reduce itself. */
export const totalCents = (lines: readonly { amountCents: number }[]): number =>
  lines.reduce((sum, line) => sum + line.amountCents, 0);
