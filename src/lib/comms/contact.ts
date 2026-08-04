/**
 * Who the product writes to about a team, and in what order of preference.
 *
 * Pure, and separate from the query that feeds it (`./recipients`) for `deposit.ts`/`deposits.ts`'
 * reason: the *rule* is a fact about the product and the *lookup* is a fact about the database, and
 * only one of those is worth a unit test.
 *
 * There is one definition of this because there are two callers and a third coming — a dues
 * reminder, a payment receipt, and whatever the next thing addressed at a team turns out to be. Two
 * copies would let a board be chased at one address and receipted at another, which is the shape of
 * bug nobody reports and everybody distrusts.
 */

/**
 * A team's contact, or nobody.
 *
 * **The registered contact wins and a captain's membership is the fallback, never the override.**
 * The person who filled in the registration form is the one who said they were the contact for this
 * team; a captain who later accepted an invitation is a second door to the same team, not a
 * correction to what the form said.
 *
 * The fallback is what makes any of this work for a founding partner. `teams.contact_person_id` is
 * written by the registration form, and setup is founder-run by design (PRD §12) — so a partner's
 * roster is *seeded*, carries no contact on any team, and without this every message addressed at a
 * team would have nowhere to go for exactly the boards the feature exists for.
 */
export const contactPersonFor = (
  team: { id: string; contactPersonId: string | null },
  captains: ReadonlyMap<string, string>,
): string | null => team.contactPersonId ?? captains.get(team.id) ?? null;
