/**
 * A5's database side — the comp's connected account, split from `./client.ts` the way
 * `src/lib/money/charges.ts` is split from `src/lib/fees/`.
 *
 * `./rates.ts` is pure and fenced; `./client.ts` talks to Stripe; this reads and writes rows. Three
 * files because they fail differently: arithmetic that must reproduce, a network call that can time
 * out, and a write that must be scoped.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit/log";
import type { BoardActor } from "@/lib/auth/scope";
import { comps, orgs, people, stripeAccounts } from "@/db/schema";
import type { CardRate } from "./rates";
import { createAccountLink, createConnectedAccount, retrieveAccount } from "./client";

export type ConnectView = {
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  nonprofitRate: boolean;
  surchargeBp: number;
};

export type ConnectResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; message: string };

/**
 * What this comp's Stripe connection looks like, or nulls when there is none.
 *
 * Scoped by `actor.compId` and resolving nothing else — the subject is the actor's own comp, which
 * is `setCompStatus`' shape. There is no id on the form to check.
 */
export const connectForBoard = async (actor: BoardActor): Promise<ConnectView> => {
  const [row] = await db
    .select({
      accountId: stripeAccounts.accountId,
      chargesEnabled: stripeAccounts.chargesEnabled,
      detailsSubmitted: stripeAccounts.detailsSubmitted,
      nonprofitRate: stripeAccounts.nonprofitRate,
      surchargeBp: stripeAccounts.surchargeBp,
    })
    .from(stripeAccounts)
    .where(eq(stripeAccounts.compId, actor.compId));

  return (
    row ?? {
      accountId: null,
      chargesEnabled: false,
      detailsSubmitted: false,
      nonprofitRate: false,
      surchargeBp: 0,
    }
  );
};

/** The card rate this comp is quoted at. A5b, read from what the board stated. */
export const cardRateFor = (view: ConnectView): CardRate =>
  view.nonprofitRate ? "nonprofit" : "standard";

/**
 * Starts or resumes onboarding, and returns the URL Stripe hosts the form at.
 *
 * **Stripe hosts it, and that is the point.** This product never sees a bank account number, a tax
 * id or a date of birth — which is the other half of never touching the org's tax status. The link
 * is single-use and short-lived, so it is minted per click rather than stored.
 *
 * Creating the account and storing its id are two statements and deliberately **not** a transaction.
 * Half of it would be an `acct_…` that exists at Stripe and is unknown here — recoverable, because
 * the next click creates a fresh one and the orphan never receives a charge. Compare the roster,
 * where half a write is an accepted team owing nothing. ADR-0012's bar is an invariant that spans
 * statements, not a write that merely has two.
 */
export const beginOnboarding = async (
  actor: BoardActor,
  urls: { returnUrl: string; refreshUrl: string },
): Promise<ConnectResult<{ url: string }>> => {
  const existing = await connectForBoard(actor);

  let accountId = existing.accountId;
  if (!accountId) {
    const [contact] = await db
      .select({ email: people.email })
      .from(comps)
      .innerJoin(orgs, eq(orgs.id, comps.orgId))
      .leftJoin(people, eq(people.id, actor.personId))
      .where(eq(comps.id, actor.compId));

    const created = await createConnectedAccount(contact?.email ?? null);
    if (!created.ok) return created;
    accountId = created.value.id;

    await db.insert(stripeAccounts).values({ compId: actor.compId, accountId });

    await recordAudit({
      compId: actor.compId,
      actorKind: "board",
      actorPersonId: actor.personId,
      action: "stripe.connect",
      entity: "comp",
      entityId: actor.compId,
      before: null,
      after: { accountId },
    });
  }

  const link = await createAccountLink(accountId, urls.returnUrl, urls.refreshUrl);
  if (!link.ok) return link;
  return { ok: true, value: { url: link.value.url } };
};

/**
 * Asks Stripe what it currently thinks, and caches the two booleans.
 *
 * They are **not the same question**, and conflating them is how a treasurer is told they are ready
 * and then watches the first payment fail: a board can finish the form (`details_submitted`) while
 * Stripe is still verifying and cannot yet accept charges (`charges_enabled`).
 */
export const refreshAccount = async (actor: BoardActor): Promise<ConnectResult<ConnectView>> => {
  const existing = await connectForBoard(actor);
  if (!existing.accountId) return { ok: false, message: "This comp has no Stripe account yet." };

  const account = await retrieveAccount(existing.accountId);
  if (!account.ok) return account;

  await db
    .update(stripeAccounts)
    .set({
      chargesEnabled: account.value.charges_enabled,
      detailsSubmitted: account.value.details_submitted,
    })
    .where(eq(stripeAccounts.compId, actor.compId));

  return {
    ok: true,
    value: {
      ...existing,
      chargesEnabled: account.value.charges_enabled,
      detailsSubmitted: account.value.details_submitted,
    },
  };
};

/**
 * A5b and A5c, both stated by the board rather than detected.
 *
 * The nonprofit rate is a fact about Stripe's verification of that account, not about the org's tax
 * status, so a product that guessed would quote a fee the statement then disagrees with. The
 * surcharge is capped at 3% here **and** by a CHECK, because a comp that set 4% would get no warning
 * from Stripe — it would get a card-network rule violation, months later, aimed at the org.
 */
export const setRates = async (
  actor: BoardActor,
  input: { nonprofitRate: boolean; surchargeBp: number },
): Promise<ConnectResult> => {
  if (!Number.isInteger(input.surchargeBp) || input.surchargeBp < 0 || input.surchargeBp > 300) {
    return {
      ok: false,
      message: "A surcharge must be between 0% and 3% — above that breaks US card-network rules.",
    };
  }

  const existing = await connectForBoard(actor);
  if (!existing.accountId) return { ok: false, message: "This comp has no Stripe account yet." };

  await db
    .update(stripeAccounts)
    .set({ nonprofitRate: input.nonprofitRate, surchargeBp: input.surchargeBp })
    .where(eq(stripeAccounts.compId, actor.compId));

  await recordAudit({
    compId: actor.compId,
    actorKind: "board",
    actorPersonId: actor.personId,
    action: "stripe.rates",
    entity: "comp",
    entityId: actor.compId,
    before: { nonprofitRate: existing.nonprofitRate, surchargeBp: existing.surchargeBp },
    after: input,
  });

  return { ok: true, value: undefined };
};
