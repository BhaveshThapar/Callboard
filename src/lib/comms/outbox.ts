/**
 * The database half of C2, split from the pure `./state` and `./render` the way `deposits.ts` is
 * split from `deposit.ts`.
 *
 * Three things happen here and only three: a message is **queued**, a due message is **claimed**,
 * and a claimed message is **resolved**. The send itself is one call to a `Transport` and happens
 * between the second and the third, deliberately outside anything holding a lock — a pool held open
 * across an HTTP request to a mail provider is how a serverless function times out mid-send.
 *
 * **Not a `withTransaction` caller** (ADR-0020). The claim is one guarded statement, which is the
 * whole point of it; resolving is an insert and an update whose disagreement is the drift
 * `db:doctor` reports rather than a half-state a human cannot reconstruct, because the chain is the
 * record and the column is a cache of it.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { violatedConstraint } from "@/db/errors";
import { COMMS_CONSTRAINTS, messageEvents, messages, people } from "@/db/schema";
import type { MessageState } from "@/db/schema";
import { backoffMs, MAX_ATTEMPTS } from "./state";
import type { MessagePayloads, TemplateName } from "./render";
import { isTemplate, render, TEMPLATE_KIND } from "./render";
import type { Transport } from "./transport";
import { transportFromEnv } from "./transport";

const now = (): Date => new Date();

export type Queued = { ok: true; messageId: string } | { ok: false; reason: "duplicate" | "error" };

/**
 * Puts a message in the outbox, or discovers it is already there.
 *
 * **A duplicate is not an error**, and the shape says so: `reason: "duplicate"` is the normal result
 * of a board clicking a reminder button twice, and treating it as a failure would put a red message
 * on a screen where nothing went wrong. What went right is that the second one did not send.
 *
 * The caller never asks whether it already sent — it inserts and reads the refusal, because the ask
 * and the insert would be two acts on neon-http and only the index is atomic.
 */
export const enqueue = async <K extends TemplateName>(
  input: {
    compId: string;
    personId: string;
    template: K;
    payload: MessagePayloads[K];
    dedupeKey: string;
    sendAfter?: Date;
    createdByPersonId?: string | null;
  },
): Promise<Queued> => {
  try {
    const [row] = await db
      .insert(messages)
      .values({
        compId: input.compId,
        personId: input.personId,
        channel: "email",
        kind: TEMPLATE_KIND[input.template],
        template: input.template,
        payload: input.payload,
        dedupeKey: input.dedupeKey,
        sendAfter: input.sendAfter ?? now(),
        createdByPersonId: input.createdByPersonId ?? null,
      })
      .returning({ id: messages.id });

    if (!row) return { ok: false, reason: "error" };

    await db.insert(messageEvents).values({ messageId: row.id, state: "queued" });
    return { ok: true, messageId: row.id };
  } catch (error) {
    if (violatedConstraint(error) === COMMS_CONSTRAINTS.dedupe) {
      return { ok: false, reason: "duplicate" };
    }
    return { ok: false, reason: "error" };
  }
};

/**
 * Records a transition on the chain and moves the cached head.
 *
 * The event first, then the column: the chain is the record, so a crash between them leaves the
 * truth written and a stale cache — which `db:doctor` reports — rather than a column claiming
 * something the history does not support.
 */
const advance = async (
  messageId: string,
  state: MessageState,
  detail: string | null,
  extra: { attempts?: number; providerRef?: string | null; sendAfter?: Date } = {},
): Promise<void> => {
  await db.insert(messageEvents).values({ messageId, state, detail });
  await db
    .update(messages)
    .set({ state, ...extra })
    .where(eq(messages.id, messageId));
};

export type Claimed = {
  id: string;
  personId: string;
  template: string;
  payload: unknown;
  kind: "transactional" | "broadcast";
  attempts: number;
  email: string | null;
  unsubscribedAt: Date | null;
};

/**
 * Takes exclusive responsibility for one message, or gets nothing.
 *
 * **This is the serialization point of the entire engine.** `WHERE state IN ('queued','failed')` is
 * inside the same statement that sets `sending`, so two cron ticks racing over the same row produce
 * one winner and one empty result — the shape `releaseAllocation` uses, for the identical reason.
 * Selecting first and updating second would be two acts, and the loser would send a second email.
 */
const claim = async (id: string): Promise<boolean> => {
  const claimed = await db
    .update(messages)
    .set({ state: "sending", attempts: sql`${messages.attempts} + 1` })
    .where(and(eq(messages.id, id), inArray(messages.state, ["queued", "failed"])))
    .returning({ id: messages.id });

  if (claimed.length === 0) return false;
  await db.insert(messageEvents).values({ messageId: id, state: "sending" });
  return true;
};

/** Candidates, narrowed by the same rule `isDue` states — the query is that predicate, indexed. */
const due = async (limit: number): Promise<Claimed[]> =>
  db
    .select({
      id: messages.id,
      personId: messages.personId,
      template: messages.template,
      payload: messages.payload,
      kind: messages.kind,
      attempts: messages.attempts,
      email: people.email,
      unsubscribedAt: people.unsubscribedAt,
    })
    .from(messages)
    .innerJoin(people, eq(people.id, messages.personId))
    .where(
      and(
        inArray(messages.state, ["queued", "failed"]),
        lte(messages.sendAfter, now()),
        sql`${messages.attempts} < ${MAX_ATTEMPTS}`,
      ),
    )
    .orderBy(asc(messages.sendAfter))
    .limit(limit) as Promise<Claimed[]>;

export type SweepResult = { claimed: number; sent: number; failed: number; skipped: number };

/**
 * One tick: claim what is due, send it, record what happened.
 *
 * A failure to *record* is the one thing this cannot make safe, and it does not pretend to — the
 * message stays in `sending`, `db:doctor` reports it, and a human decides. Retrying automatically
 * would email somebody twice, and a duplicate is invisible from inside the system (ADR-0020).
 */
export const sweep = async (
  limit = 25,
  transport: Transport = transportFromEnv(),
  baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "",
): Promise<SweepResult> => {
  const result: SweepResult = { claimed: 0, sent: 0, failed: 0, skipped: 0 };

  for (const candidate of await due(limit)) {
    // Suppression is checked at send rather than at enqueue, because a person may unsubscribe in
    // between — and the queued row is the record that a board meant to tell them something.
    if (candidate.kind === "broadcast" && candidate.unsubscribedAt) {
      await advance(candidate.id, "bounced", "recipient unsubscribed");
      result.skipped += 1;
      continue;
    }
    if (!candidate.email) {
      await advance(candidate.id, "bounced", "no email address on file");
      result.skipped += 1;
      continue;
    }
    if (!isTemplate(candidate.template)) {
      await advance(candidate.id, "bounced", `unknown template ${candidate.template}`);
      result.skipped += 1;
      continue;
    }

    if (!(await claim(candidate.id))) continue;
    result.claimed += 1;

    const content = render(
      candidate.template,
      candidate.payload as MessagePayloads[typeof candidate.template],
    );

    const sent = await transport.send({
      to: candidate.email,
      subject: content.subject,
      body: content.body,
      ...(candidate.kind === "broadcast" && baseUrl
        ? { unsubscribeUrl: `${baseUrl}/unsubscribe/${candidate.personId}` }
        : {}),
    });

    if (sent.ok) {
      await advance(candidate.id, "sent", null, { providerRef: sent.providerRef });
      result.sent += 1;
      continue;
    }

    await advance(
      candidate.id,
      sent.retryable ? "failed" : "bounced",
      sent.detail,
      sent.retryable
        ? { sendAfter: new Date(now().getTime() + backoffMs(candidate.attempts + 1)) }
        : {},
    );
    result.failed += 1;
  }

  return result;
};
