/**
 * A5a/A5b/A5c — what a payment costs to accept, and who pays it.
 *
 * Pure, and **fenced by ESLint as the fourth zone**, on `src/lib/coord/duties.ts`' test: a zone
 * protects *reproducibility of a number somebody is billed or ranked by*, and this is exactly that
 * number. A surcharge is a line a dancer reads at checkout and a `fee_cents` is what the ledger
 * carries forever; both must be a function of the amount and the rate card alone, never of the day
 * or of which server answered.
 *
 * Every amount is integer cents, [ADR-0002](../../../docs/decisions/0002-money-as-cents-and-allocations.md).
 * There is no float in this file and there must not be: a rounding difference here is the ~$5,000
 * gap of PRD §14 reintroduced by the feature that exists to close it.
 */

/**
 * The rails Stripe can actually move money over, as distinct from the rails the ledger *records*.
 *
 * `payments.rail` already carries `venmo`, `zelle`, `check` and `cash` — things that exist in the
 * world and that Callboard does not route. These two are the ones Connect can charge.
 */
export const ROUTED_RAILS = ["ach", "card"] as const;
export type RoutedRail = (typeof ROUTED_RAILS)[number];

/**
 * A connected account's card rate. Most host orgs are 501(c)(3)s and qualify for the lower one;
 * PAYMENTS.md's line is *"Most host orgs qualify; nobody has told them."*
 *
 * Stated per comp rather than detected, because whether Stripe has *verified* the nonprofit status
 * on that connected account is a fact about their dashboard, not about their tax status, and a
 * product that guessed would quote a fee the statement then disagrees with.
 */
export type CardRate = "standard" | "nonprofit";

export type RateCard = {
  /** ACH: 0.8%, capped. Both from PAYMENTS.md; both are Stripe's published US rates. */
  achBp: number;
  achCapCents: number;
  cardBp: number;
  cardFixedCents: number;
};

/**
 * Stripe's US rates, as of the day this was written, and **stated as data because they are Stripe's
 * to change**. A rate that moves is a config edit and a re-quote, not a migration — the fee schedule's
 * own argument, applied to somebody else's price list.
 */
export const US_RATES: Record<CardRate, RateCard> = {
  standard: { achBp: 80, achCapCents: 500, cardBp: 290, cardFixedCents: 30 },
  nonprofit: { achBp: 80, achCapCents: 500, cardBp: 220, cardFixedCents: 30 },
};

/**
 * Rounds half **up**, on integers, with no float anywhere.
 *
 * `Math.round(x / 10_000)` would take the amount through a float and is wrong for exactly the
 * numbers this product is sold against: it is the difference between a fee of $2.99 and $3.00 on a
 * statement a treasurer is reconciling by eye.
 */
const applyBp = (cents: number, bp: number): number => Math.floor((cents * bp + 5_000) / 10_000);

/**
 * What Stripe takes to accept `grossCents` over `rail`.
 *
 * The **cap is the whole point of A5a**. ACH is 0.8% capped at $5, so anything above ~$625 pays a
 * flat five dollars — and team payments are $600–$2,160 lumps, not impulse checkouts. On Mayuri's
 * ~$11.5k season that is the difference between ~$250 all-card and roughly $60–80.
 */
export const processingFeeCents = (
  grossCents: number,
  rail: RoutedRail,
  rate: CardRate,
  rates: Record<CardRate, RateCard> = US_RATES,
): number => {
  if (!Number.isInteger(grossCents) || grossCents <= 0) return 0;
  const card = rates[rate];
  if (rail === "ach") return Math.min(applyBp(grossCents, card.achBp), card.achCapCents);
  return applyBp(grossCents, card.cardBp) + card.cardFixedCents;
};

/**
 * Which rail a payment of this size should default to.
 *
 * *"Route registration and hotel payments over ACH by default; keep cards available for small items
 * and last-minute payers"* — so this is a **default and not a rule**. It returns what the form should
 * pre-select; a payer who wants a card gets one, because the alternative to a card at 11pm the night
 * before a comp is a payment that does not happen.
 */
export const defaultRail = (grossCents: number): RoutedRail => (grossCents >= 25_000 ? "ach" : "card");

export type SurchargePlan = {
  /** What the team is asked for, including any pass-through. */
  chargedCents: number;
  /** The disclosed line, zero when the comp absorbs it. */
  surchargeCents: number;
  /** What Stripe takes from the connected account once the charge succeeds. */
  feeCents: number;
  /** What the org keeps. Equal to what it billed exactly when the surcharge is passed through. */
  netCents: number;
};

/**
 * A5c — the honest answer to *"won't we net less than we charge?"*
 *
 * The comp can pass the processing fee to the payer, disclosed at checkout, **capped at 3%** by US
 * card-network surcharge rules. The cap is enforced here rather than trusted to configuration,
 * because a comp that set 4% would not get a warning from Stripe — it would get a chargeback and a
 * rule violation, months later.
 *
 * **Charging the fee on the fee is deliberate and bounded.** Passing on a 2.9% fee means the payer
 * pays more, which means Stripe takes more, which means the org is still short. Solving that exactly
 * is a division that does not land on an integer; solving it not at all leaves the org short by a
 * few cents on every payment, which is a discrepancy nobody was shown — PRD §14's own species. So
 * the surcharge is computed on the grossed-up amount and then **clamped to the cap**, and `netCents`
 * states what the org actually keeps rather than assuming it came out even.
 */
export const planSurcharge = (
  owedCents: number,
  rail: RoutedRail,
  rate: CardRate,
  options: { passThrough: boolean; capBp?: number },
  rates: Record<CardRate, RateCard> = US_RATES,
): SurchargePlan => {
  const bare = processingFeeCents(owedCents, rail, rate, rates);
  if (!options.passThrough) {
    return {
      chargedCents: owedCents,
      surchargeCents: 0,
      feeCents: bare,
      netCents: owedCents - bare,
    };
  }

  const capBp = options.capBp ?? 300;
  const capCents = applyBp(owedCents, capBp);
  // One gross-up pass, then the cap. A second pass would chase cents the cap forbids collecting.
  const grossedUp = owedCents + bare;
  const surchargeCents = Math.min(processingFeeCents(grossedUp, rail, rate, rates), capCents);
  const chargedCents = owedCents + surchargeCents;
  const feeCents = processingFeeCents(chargedCents, rail, rate, rates);

  return { chargedCents, surchargeCents, feeCents, netCents: chargedCents - feeCents };
};
