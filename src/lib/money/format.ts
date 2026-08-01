/**
 * The only place integer cents become a string with a dot in it.
 *
 * Pure, and called only from `.tsx` and the CSV builder. Everything upstream of here stays in
 * integer cents (ADR-0002) — a helper that returned a `number` of dollars would put a float back in
 * the middle of the pipeline, which is the bug the whole money model is shaped to avoid.
 */

/** `112000` → `"$1,120.00"`. Negative reads `"-$1,120.00"`, because the sign is the information. */
export const formatCents = (cents: number): string => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${remainder.toString().padStart(2, "0")}`;
};

/**
 * What a balance *means*, in the board's words rather than in a sign convention. A treasurer reading
 * "-$1,120.00" has to work out who owes whom; this says it.
 */
export const describeBalance = (balanceCents: number): string => {
  if (balanceCents === 0) return "settled";
  if (balanceCents < 0) return `owed ${formatCents(-balanceCents)}`;
  return `owes ${formatCents(balanceCents)}`;
};
