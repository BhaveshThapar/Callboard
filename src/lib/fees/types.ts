/**
 * The fee engine's vocabulary. It lives here rather than in `src/db/schema/` for the reason
 * `TabulationInput` does: the pure module owns the definition and the schema imports it, so the
 * dependency points db → lib and the pure directory can stay fenced off from the database.
 */

/** One definition: the type, `charges_kind_check`, and everything the engine emits derive from it. */
export const CHARGE_KINDS = ["registration", "hotel", "deposit", "late_fee"] as const;

export type ChargeKind = (typeof CHARGE_KINDS)[number];

export type FeeSchedule = {
  perDancerCents: number;
  perRoomCents: number;
  depositCents: number;
  lateFeeCents: number;
  /** ISO date (`YYYY-MM-DD`), or null when the comp charges no late fee. */
  lateAfter: string | null;
};

export type BillableTeam = {
  teamId: string;
  /** Null means *not yet known*. It does not mean zero. */
  rosterSize: number | null;
  /** Null means *not yet known*. It does not mean zero. */
  rooms: number | null;
};

export type FeeInput = {
  schedule: FeeSchedule;
  teams: readonly BillableTeam[];
  /** ISO date. Passed in, never read from a clock. */
  asOf: string;
};

/** A charge the schedule says exists. No id and no timestamp — those belong to the row, not here. */
export type ChargeLine = {
  teamId: string;
  kind: ChargeKind;
  amountCents: number;
};

/**
 * A line the schedule *would* have produced if something were known. Stated, never guessed: a comp
 * that bills per room and a team whose room count is null gets no hotel charge and one of these.
 * A $0 hotel charge is a lie a treasurer will believe.
 */
export type BillingGap = {
  teamId: string;
  kind: ChargeKind;
  missing: "rosterSize" | "rooms";
};

/** A charge that already exists, as `planCharges` needs to see it. */
export type ExistingCharge = {
  id: string;
  teamId: string;
  kind: ChargeKind;
  amountCents: number;
};

export type ChargePlan = {
  insert: ChargeLine[];
  void: ExistingCharge[];
  unchanged: ExistingCharge[];
};
