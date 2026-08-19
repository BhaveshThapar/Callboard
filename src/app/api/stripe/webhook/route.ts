import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { violatedConstraint } from "@/db/errors";
import { comps, STRIPE_CONSTRAINTS, stripeAccounts, stripeEvents, teams } from "@/db/schema";
import { verifySignature } from "@/lib/stripe/client";
import { recordRoutedPayment } from "@/lib/money/ledger";

export const dynamic = "force-dynamic";

/**
 * A5 — where money that actually moved becomes a row in the ledger.
 *
 * **This endpoint does not create a second way to write money.** It calls `recordRoutedPayment`,
 * which writes through the *same* `insertPayment` the treasurer's form uses — one function, extracted
 * so this claim is enforced rather than asserted. The allocation counter, the `net = gross - fee`
 * check and every `MONEY_CONSTRAINTS` guarantee apply identically. A webhook that inserted its own row would
 * be a second definition of what a payment is, and the first divergence between them would be
 * invisible — which is the ~$5,000 gap of PRD §14 arriving through the feature built to close it.
 *
 * **Three refusals, in order, and the order matters.**
 *
 * 1. **Signature first, before the body is parsed as anything meaningful.** This route is
 *    unauthenticated by necessity — Stripe has no cookie — so the HMAC is the only thing between it
 *    and anybody who can POST a `payment_intent.succeeded`.
 * 2. **Then the replay guard**, as an insert that reads its refusal rather than a `select` that asks.
 *    Stripe redelivers until it gets a 2xx and again after any 5xx, so a duplicate is the ordinary
 *    path the first time a deploy is slow, not a rare one. The ask and the insert are two acts and
 *    only the index is atomic — [ADR-0020](../../../../docs/decisions/0020-a-message-sends-once.md)'s
 *    lesson, one table over. **A duplicate is answered 200**, because a non-2xx makes Stripe retry
 *    the thing it has already done.
 * 3. **Then the comp**, resolved from the connected account rather than from the event's metadata,
 *    so a forged `compId` in metadata cannot attribute a payment to a comp the account does not own.
 */
export const POST = async (request: Request): Promise<Response> => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // 503, not 500: the deployment is not configured, which is a caveat about this host rather than
    // a fault in the request. `db:doctor --host` reports it by name.
    return Response.json({ error: "stripe webhooks are not configured" }, { status: 503 });
  }

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!verifySignature(payload, signature, secret, Math.floor(Date.now() / 1000))) {
    // 400 rather than 404: this one is not hiding its own existence, because Stripe needs to be able
    // to tell a misconfigured secret from a wrong URL, and an attacker learns nothing either way.
    return Response.json({ error: "bad signature" }, { status: 400 });
  }

  const event = JSON.parse(payload) as {
    id: string;
    type: string;
    account?: string;
    data: { object: Record<string, unknown> };
  };

  const accountId = event.account ?? null;
  const [linked] = accountId
    ? await db
        .select({ compId: stripeAccounts.compId })
        .from(stripeAccounts)
        .where(eq(stripeAccounts.accountId, accountId))
    : [];

  try {
    await db.insert(stripeEvents).values({
      eventId: event.id,
      type: event.type,
      accountId,
      compId: linked?.compId ?? null,
    });
  } catch (error) {
    if (violatedConstraint(error) === STRIPE_CONSTRAINTS.eventOnce) {
      // Already handled. Not an error -- this is what a redelivery looks like, and it is the state
      // the index exists to produce. `A duplicate is not an error`, the outbox's own words.
      return Response.json({ received: true, duplicate: true });
    }
    throw error;
  }

  if (event.type !== "payment_intent.succeeded" || !linked) {
    // Recorded above and deliberately not acted on. An account-updated event, say, is handled by the
    // board's own refresh; recording it means a later question about what arrived has an answer.
    return Response.json({ received: true, handled: false });
  }

  const intent = event.data.object as {
    id?: string;
    amount_received?: number;
    metadata?: { teamId?: string; compId?: string };
    latest_charge?: string;
  };

  const teamId = intent.metadata?.teamId;
  const gross = intent.amount_received;
  if (typeof teamId !== "string" || typeof gross !== "number" || gross <= 0) {
    return Response.json({ received: true, handled: false, reason: "no attributable amount" });
  }

  // The team is resolved **against the comp the connected account belongs to**, never against the
  // metadata alone. `a teamId on a form is a claim` applies to a webhook body at least as strongly:
  // the body is written by whoever created the session, and the account is what Stripe vouches for.
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .innerJoin(comps, eq(comps.id, teams.compId))
    .where(and(eq(teams.id, teamId), eq(teams.compId, linked.compId)));

  if (!team) {
    return Response.json({ received: true, handled: false, reason: "team not in that comp" });
  }

  /**
   * `fee_cents` is **0 here and that is deliberate**, not an omission.
   *
   * Stripe's actual fee lives on the balance transaction, which is a separate fetch and is not final
   * at the moment the intent succeeds. Guessing it from the rate card would put a number in the
   * ledger that the March statement then disagrees with — and `payments` splits gross/fee/net
   * precisely so a disagreement is visible rather than absorbed. So the fee arrives later, by the
   * same hand-entry path that has always corrected one, and the row is honest in the meantime.
   */
  const result = await recordRoutedPayment({
    compId: linked.compId,
    teamId: team.id,
    grossCents: gross,
    feeCents: 0,
    rail: "card",
    externalRef: intent.id ?? event.id,
  });

  return Response.json({ received: true, handled: result.ok, ...(result.ok ? {} : { reason: result.message }) });
};
