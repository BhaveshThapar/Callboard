/**
 * Stripe over `fetch`, with no SDK.
 *
 * A11 set this precedent for Google: OAuth against the REST endpoints rather than `googleapis`,
 * *"keeping the five-dependency property"*. The same argument holds harder here — `stripe` is a
 * large dependency whose surface is mostly things this product refuses to do, and the parts actually
 * used are three POSTs and one signature check.
 *
 * **Nothing here holds funds** ([ADR-0005](../../../docs/decisions/0005-stripe-connect-standard-never-hold-funds.md)).
 * Every call names a connected account with `Stripe-Account`, so the charge belongs to the org and
 * settles to the org. The platform secret authorizes the request; it does not receive the money.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.stripe.com/v1";

/**
 * **An empty string is not configured**, and this said `!== undefined` for an hour, which is not the
 * same test. Setting the variable with no value is a real thing that happens — it is what
 * `vercel env add` leaves behind if you paste nothing — and under the wrong test the screen reports
 * *ready to take payments* while every call 401s.
 *
 * `transportFromEnv` had this right from the start (`key && from`), for the reason stated there: the
 * failure mode of getting it backwards is a screen claiming something the deployment cannot do.
 */
export const stripeConfigured = (): boolean => (process.env.STRIPE_SECRET_KEY ?? "") !== "";

export type StripeResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Stripe takes form-encoded bodies, including for nested objects, which is why this is hand-rolled
 * rather than `JSON.stringify`. `capabilities[card_payments][requested]=true` is a real parameter
 * name and there is no way to express it in JSON.
 */
const form = (params: Record<string, string | number | boolean | undefined>): string =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

const call = async <T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  onBehalfOf?: string,
): Promise<StripeResult<T>> => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, message: "Stripe is not configured on this deployment." };

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/x-www-form-urlencoded",
        // Pinned, because Stripe changes shapes between versions and a silent upgrade would change
        // what a webhook means without anything in this repo moving.
        "Stripe-Version": "2025-04-30.basil",
        ...(onBehalfOf ? { "Stripe-Account": onBehalfOf } : {}),
      },
      body: form(params),
    });
  } catch {
    // A refused connection is not the same as a refused charge, and a treasurer must not read it as
    // one. `neverArrived`'s distinction, one API over.
    return { ok: false, message: "Could not reach Stripe. Nothing was charged; try again." };
  }

  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    // Stripe's own message is written for a developer but is the only thing that says what is
    // actually wrong, so it is surfaced rather than replaced with a generic sentence.
    return { ok: false, message: body?.error?.message ?? `Stripe returned ${response.status}.` };
  }
  return { ok: true, value: body as T };
};

export type ConnectedAccount = {
  id: string;
  charges_enabled: boolean;
  details_submitted: boolean;
};

/**
 * Creates the comp's own Stripe account. **Standard**, which is the whole decision.
 *
 * Express would be a slicker onboarding and would put Callboard closer to the funds. That proximity
 * is the thing being refused.
 */
export const createConnectedAccount = async (
  email: string | null,
): Promise<StripeResult<ConnectedAccount>> =>
  call<ConnectedAccount>("/accounts", {
    type: "standard",
    country: "US",
    email: email ?? undefined,
  });

/**
 * A single-use onboarding URL. Stripe hosts the form; this product never sees a bank number, a tax
 * id or a date of birth, which is the other half of never touching the org's tax status.
 */
export const createAccountLink = async (
  accountId: string,
  returnUrl: string,
  refreshUrl: string,
): Promise<StripeResult<{ url: string }>> =>
  call<{ url: string }>("/account_links", {
    account: accountId,
    type: "account_onboarding",
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });

export const retrieveAccount = async (accountId: string): Promise<StripeResult<ConnectedAccount>> => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, message: "Stripe is not configured on this deployment." };
  try {
    const response = await fetch(`${API}/accounts/${accountId}`, {
      headers: { authorization: `Bearer ${key}`, "Stripe-Version": "2025-04-30.basil" },
    });
    const body = (await response.json().catch(() => null)) as
      | (ConnectedAccount & { error?: { message?: string } })
      | null;
    if (!response.ok) return { ok: false, message: body?.error?.message ?? "Stripe refused." };
    return { ok: true, value: body as ConnectedAccount };
  } catch {
    return { ok: false, message: "Could not reach Stripe." };
  }
};

/**
 * A hosted page that takes one team's payment, on the org's account.
 *
 * `payment_method_types` is where A5a lives: ACH first for a lump, card for a small or last-minute
 * item. Both are always *available* — the default is a default, because the alternative to a card at
 * 11pm the night before a comp is a payment that does not happen.
 *
 * `metadata` carries the ids the webhook needs to attribute the money. It is the only channel: the
 * webhook arrives from Stripe with no session and no cookie, so anything not written here is
 * unrecoverable when it lands.
 */
export const createCheckoutSession = async (
  accountId: string,
  input: {
    compId: string;
    teamId: string;
    amountCents: number;
    surchargeCents: number;
    rail: "ach" | "card";
    description: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<StripeResult<{ id: string; url: string }>> =>
  call<{ id: string; url: string }>(
    "/checkout/sessions",
    {
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      "payment_method_types[0]": input.rail === "ach" ? "us_bank_account" : "card",
      "payment_method_types[1]": input.rail === "ach" ? "card" : "us_bank_account",
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": input.amountCents,
      "line_items[0][price_data][product_data][name]": input.description,
      // A5c: disclosed as its own line, because "the paying dancer sees a processing fee line, as
      // they already do everywhere else" is the requirement, not a rounded-up total.
      ...(input.surchargeCents > 0
        ? {
            "line_items[1][quantity]": 1,
            "line_items[1][price_data][currency]": "usd",
            "line_items[1][price_data][unit_amount]": input.surchargeCents,
            "line_items[1][price_data][product_data][name]": "Processing fee",
          }
        : {}),
      "metadata[compId]": input.compId,
      "metadata[teamId]": input.teamId,
      "payment_intent_data[metadata][compId]": input.compId,
      "payment_intent_data[metadata][teamId]": input.teamId,
    },
    accountId,
  );

/**
 * Whether this request really came from Stripe.
 *
 * **The single most important function in this file.** The webhook endpoint is unauthenticated by
 * necessity — Stripe has no cookie — so the signature is the only thing between it and anybody who
 * can POST a `payment_intent.succeeded` and have the ledger record money that never arrived.
 *
 * `timingSafeEqual`, not `===`: comparing HMACs with a short-circuiting comparison leaks the prefix
 * a byte at a time, and this is the one place in the repo where that matters. The timestamp is
 * checked too, because a valid signature replayed a week later is still a valid signature.
 */
export const verifySignature = (
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean => {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k?.trim() ?? "", rest.join("=")];
    }),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isFinite(timestamp) || typeof signature !== "string") return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
};
