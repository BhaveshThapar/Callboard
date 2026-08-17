/**
 * The verdict on whether a seeded demo is one a prospect can be shown. Pure and DB-free so it
 * unit-tests without DATABASE_URL; `doctor.ts` gathers the `Observed` facts and applies it.
 */

/**
 * Whose environment a config verdict is about.
 *
 * The whole reason this field exists: `db:doctor` is documented as being run with production's
 * `DATABASE_URL` in front of it, and `process.env.RESEND_API_KEY` is still the laptop's. A config
 * section that did not say which host it had asked would print a verdict about the wrong one, under
 * a line that says *the deployed demo* — which is the exact defect this check was added to close,
 * reproduced one layer out.
 */
export type ConfigSource = "this shell" | { host: string };

/**
 * Which configuration groups the environment behind a verdict actually carries.
 *
 * States and variable *names* only, never a value read out of `process.env`. A preflight that
 * printed a key would be a preflight nobody could paste into an issue.
 */
export type ConfigObserved = {
  sending: "on" | "off" | "partial";
  /** Which of the pair is absent, when `partial`. */
  sendingMissing: readonly string[];
  cron: boolean;
  baseUrl: boolean;
  drive: "on" | "off" | "partial";
  driveMissing: readonly string[];
  sealing: "on" | "off" | "unusable";
  /** Decoded length, only when `unusable`, so the sentence can say what is actually wrong. */
  sealingKeyBytes: number | null;
  source: ConfigSource;
};

/**
 * Two lists, because an absence and a contradiction are not the same fact.
 *
 * **A caveat is reported and never fatal.** A laptop legitimately has no Resend key, and production
 * having none is a deliberate, documented state that three files argue for on purpose. A preflight
 * that went red for it would be a preflight the founder learns to ignore before a prospect call,
 * which is the failure `schemaProblems` above already names: one that cries wolf gets skipped.
 *
 * **A hazard is set-but-unusable, or a combination whose effect is destructive.** Somebody has
 * already done the work and the product is not getting the benefit — or worse, is about to do
 * something it cannot take back.
 */
export type ConfigVerdict = {
  caveats: string[];
  hazards: string[];
  source: ConfigSource;
};

/**
 * `ok` answers *can a prospect be shown this database?* The config verdict answers *would a button
 * on this host do what the screen says?* Two questions, so they must not share one boolean — and
 * specifically because `db:seed` gates on `ok`, so a config fact landing in `problems` would make a
 * missing mail key refuse to seed a demo.
 */
export type DemoHealth =
  | { ok: true; board: string; judges: number; teams: number; config: ConfigVerdict }
  | { ok: false; problems: string[]; config: ConfigVerdict };

export type Observed = {
  config: ConfigObserved;
  /**
   * Migrations this database has applied, or null when the `drizzle` schema is absent — skipped,
   * not guessed, the same rule the money queries follow when their tables are missing.
   */
  migrationsApplied: number | null;
  /** Migrations the repo carries: `drizzle/meta/_journal.json`, which is the one definition. */
  migrationsExpected: number;
  compFound: boolean;
  boardAssignments: number;
  boardName: string | null;
  boardViewLoaded: boolean;
  judges: number;
  judgeViewLoaded: boolean;
  /** Distinct `Judge N` labels the board's de-identified projection resolves. */
  judgeLabels: number;
  teams: number;
  /** Both partial unique indexes on `tab_runs` exist: the chain cannot fork. */
  forkGuaranteeEnforced: boolean;
  /** Comps whose run chain does not have exactly one root. Only ever non-empty above. */
  forkedComps: { compId: string; roots: number }[];
  /** Every constraint in `MONEY_CONSTRAINTS` exists: an over-allocation is unrepresentable. */
  moneyGuaranteeEnforced: boolean;
  /**
   * Payments whose `allocated_cents` disagrees with the sum of their live allocations — ADR-0014's
   * named residual. The database enforces `allocated <= gross`, not `allocated = sum(...)`, so this
   * is the half that has to be *found* rather than refused.
   */
  driftingPayments: { paymentId: string; allocatedCents: number; allocatedSum: number }[];
  /**
   * Live allocations pointing at a charge that has been voided — money recorded against an
   * obligation that no longer exists. The counter and the live allocations still agree, so the
   * drift check above is blind to it by construction.
   */
  orphanedAllocations: { paymentId: string; chargeId: string; amountCents: number }[];
  /**
   * Deposits with more than one ending — `forkedComps`, one table over. Unrepresentable since
   * `deposit_events_terminal_unique` was rekeyed to `(comp_id, team_id)` in `0011`, which is exactly
   * why the doctor has to look: the guarantee lives in the database, not in the code.
   */
  forkedDeposits: { teamId: string; endings: number }[];
  /**
   * Payments carrying `refunded_cents` with no `refunded` deposit event to explain it. The second
   * denormalized number in the schema, and the second one no CHECK can reconcile — the agreement
   * spans tables (ADR-0015).
   */
  unexplainedRefunds: { paymentId: string; refundedCents: number }[];
  /**
   * Every constraint in `ACCOUNT_CONSTRAINTS` exists: a second live invitation to the same person,
   * a duplicate login for one email, or two sessions sharing a token are all unrepresentable.
   */
  accountGuaranteeEnforced: boolean;
  coordGuaranteeEnforced: boolean;
  /**
   * People holding more than one unspent invitation to the same comp and role — the state
   * `invitations_live_unique` makes impossible, and therefore the state that says the index is gone.
   * `forkedComps` and `forkedDeposits`' sibling, one table further out.
   */
  duplicateInvitations: { personId: string; live: number }[];
  /** Every constraint in `COMMS_CONSTRAINTS` exists: a second send is unrepresentable. */
  commsGuaranteeEnforced: boolean;
  /**
   * Messages whose cached `state` disagrees with the head of their own chain — ADR-0020's named
   * residual, and ADR-0014's twice over: the database can enforce the terminal index and the dedupe
   * key, and cannot enforce that a cache agrees with the record it caches.
   */
  driftingMessages: { messageId: string; state: string; head: string }[];
  /**
   * Claimed and never resolved. **The crash-after-send footprint**, and the one state that must be
   * reported rather than retried: retrying emails somebody twice, and a duplicate is invisible from
   * inside the system.
   */
  stuckMessages: { messageId: string; minutes: number }[];
};

const RESEED = "reseed with 'bun run db:seed'";

/**
 * Whether this database has the schema the code in front of it expects.
 *
 * The other two database-level checks are *constraint-shaped*: they ask whether a specific
 * guarantee is enforceable, and each names the migration that adds it. That is stronger than a
 * version number where it applies — and it is blind wherever a migration adds no constraint.
 *
 * Migrations `0007` and `0008` are pure `ADD COLUMN`. They carry no index and no CHECK, so nothing
 * below could see them missing, and on July 13 2026 the first of them broke every page that reads
 * `comps.registration` on the deployed demo. That outage ran nineteen days. The money check would
 * have caught it on July 31, when `0009` landed — eighteen days late — and only because the money
 * spine happened to add constraints.
 *
 * So this is the generic backstop, deliberately weaker and deliberately broader: it does not know
 * what is missing, only that the database is behind the repo. Counting rather than comparing hashes
 * is on purpose — a hash comparison would also flag a migration edited after it was applied, which
 * is a different failure with no evidence of ever happening here, and a preflight that cries wolf
 * is a preflight that gets skipped before a call.
 *
 * **The sentence has one definition; the policy on `unknown` belongs to each caller.** `db:doctor`
 * skips it — a database with no `drizzle` schema is one this cannot tell about, and guessing would
 * make the preflight cry wolf. `db:migration-check` fails on it, because CI asking production how
 * far along it is and getting "no drizzle schema" means it reached something that is not the
 * production database. Same string, two remedies, which is `CHAIN_INDEXES`' arrangement exactly.
 */
export type MigrationComparison =
  | { state: "level"; applied: number; expected: number }
  | { state: "ahead"; applied: number; expected: number }
  | { state: "behind"; applied: number; expected: number; behind: number; sentence: string }
  | { state: "unknown"; expected: number; sentence: string };

export const compareMigrations = (
  applied: number | null,
  expected: number,
): MigrationComparison => {
  if (applied === null) {
    return {
      state: "unknown",
      expected,
      sentence:
        "this database has no 'drizzle' schema, so it has never had a migration applied and " +
        "cannot say how far along it is.",
    };
  }

  // `ahead` is a real state and deliberately not a problem: production legitimately runs ahead of a
  // checkout during a deploy, and of an older branch always. It is reported, never failed on.
  if (applied > expected) return { state: "ahead", applied, expected };
  if (applied === expected) return { state: "level", applied, expected };

  const behind = expected - applied;
  return {
    state: "behind",
    applied,
    expected,
    behind,
    sentence:
      `this database is ${behind} migration${behind === 1 ? "" : "s"} behind the repo ` +
      `(${applied} applied, ${expected} in drizzle/). ` +
      "The code deployed in front of it expects columns and tables it does not have — apply them " +
      "with 'bun run db:migrate'.",
  };
};

/**
 * Reseeding is not offered, for the reason the other checks do not offer it: a seed does not apply a
 * migration, and `db:seed` runs this very check afterwards and would refuse to print links anyway.
 */
const schemaProblems = (observed: Observed): string[] => {
  const comparison = compareMigrations(observed.migrationsApplied, observed.migrationsExpected);
  return comparison.state === "behind" ? [comparison.sentence] : [];
};

/**
 * Whether the database can still fork a comp's run chain, and whether one already has.
 *
 * These are facts about the *database*, not about the demo comp, so they outlive the "comp not
 * seeded" short-circuit below: a demo nobody has seeded yet on a database missing the indexes is
 * still a database missing the indexes, and reseeding will not add them.
 *
 * The two are one question. Once `tab_runs_root_unique` exists a second root is unrepresentable, so
 * a forked comp can only be found on a database that never got the migration — which makes this the
 * preflight for applying it. A comp with no runs at all yields nothing here: an unlocked demo is
 * healthy, not forked.
 */
const chainProblems = (observed: Observed): string[] => {
  const problems: string[] = [];

  if (!observed.forkGuaranteeEnforced) {
    problems.push(
      "a comp's locked results can still fork: the tab_runs chain indexes are missing. " +
        "This database predates migration 0006 — apply it with 'bun run db:migrate'.",
    );
  }

  for (const { compId, roots } of observed.forkedComps) {
    problems.push(
      `comp ${compId} has ${roots} locked-result chains, not one. A human must decide which ` +
        "result stood — migration 0006 cannot be applied until one does.",
    );
  }

  return problems;
};

/**
 * Whether the money tables can still hold a state a treasurer cannot act on, and whether one
 * already does.
 *
 * The same two-part shape as `chainProblems`, and for the same reason. `MONEY_CONSTRAINTS` makes
 * over-allocation, a broken `net = gross - fee`, a duplicate obligation and a replayed payment all
 * *unrepresentable* — but only on a database that actually carries them, and the code may not
 * assume it is the database the code intended.
 *
 * The drift check is the half no constraint can do. ADR-0014 accepted a named residual: the CHECK
 * constrains the counter, not the sum it stands for, so anything writing an allocation without
 * moving the counter creates a disagreement. Refusing it is impossible; finding it is not, and a
 * disagreement someone is shown is the whole difference between this and a number that is silently
 * wrong. Reseeding fixes neither, and is not offered for either.
 */
const moneyProblems = (observed: Observed): string[] => {
  const problems: string[] = [];

  if (!observed.moneyGuaranteeEnforced) {
    // Deliberately no migration number. `MONEY_CONSTRAINT_NAMES` spans three migrations now --
    // `0009` for the ledger, `0010` for the deposit terminal, `0011` for the refund ceiling -- so a
    // sentence naming one of them is wrong for the other two, and it named 0009 for a day while
    // `deposit_events_terminal_unique` shipped in 0010. `schemaProblems` says how far behind this
    // database actually is, from the journal, which is the number that was always true.
    problems.push(
      "a payment can still be allocated past what was paid, or refunded past it: the money " +
        "constraints are missing. Apply the migrations with 'bun run db:migrate'.",
    );
  }

  for (const { paymentId, allocatedCents, allocatedSum } of observed.driftingPayments) {
    problems.push(
      `payment ${paymentId} says ${allocatedCents} cents are allocated but its live allocations ` +
        `sum to ${allocatedSum}. Something wrote an allocation without moving the counter; a human ` +
        "must decide which figure is true before the balance it feeds can be trusted.",
    );
  }

  // The second detectable bad state of the same family, and the one the drift check structurally
  // cannot see: the counter and the live allocations agree perfectly, it is the charge underneath
  // that has gone. Voiding a charge now releases its allocations, so this can only be a row written
  // before that did — which is exactly why the doctor has to look rather than assume.
  for (const { paymentId, chargeId, amountCents } of observed.orphanedAllocations) {
    problems.push(
      `payment ${paymentId} still has ${amountCents} cents allocated to charge ${chargeId}, which ` +
        "has been voided. The money is recorded against an obligation that no longer exists; a " +
        "human must release it so it reads as unattached credit.",
    );
  }

  // A deposit that ended twice, which is `forkedComps`' sentence about a smaller question -- and it
  // gets the same refusal to offer a reseed, for the same reason: reseeding does not create an index
  // and does not decide which of two endings actually happened.
  for (const { teamId, endings } of observed.forkedDeposits) {
    problems.push(
      `team ${teamId} has ${endings} deposit endings, and a deposit ends once. A human must decide ` +
        "which one happened before any balance built on it can be trusted.",
    );
  }

  for (const { paymentId, refundedCents } of observed.unexplainedRefunds) {
    problems.push(
      `payment ${paymentId} records ${refundedCents} cents refunded, but its team's deposit was ` +
        "never returned. Something moved the money without ending the deposit; the books claim to " +
        "have paid out what nothing accounts for.",
    );
  }

  return problems;
};

/**
 * The credential half, and it earns its place for `moneyProblems`' reason: a guarantee that lives in
 * the database is one the code cannot assume is there.
 *
 * A missing `invitations_live_unique` is the dangerous one. Nothing in the product produces two live
 * invitations — `invite` revokes the previous envelope first — so a duplicate means either the index
 * is gone or something wrote around the product, and both mean a person can be handed two valid ways
 * into one comp. Reseeding fixes neither and is not offered, for the reason it is not offered for a
 * forked chain.
 */
const accountProblems = (observed: Observed): string[] => {
  const problems: string[] = [];

  if (!observed.coordGuaranteeEnforced) {
    problems.push(
      "a person can be assigned the same duty twice: the assignments indexes are missing. " +
        "Apply the migrations with 'bun run db:migrate'.",
    );
  }

  if (!observed.accountGuaranteeEnforced) {
    problems.push(
      "a person can still hold two live invitations to one comp, or two accounts on one email: " +
        "the account constraints are missing. Apply the migrations with 'bun run db:migrate'.",
    );
  }

  for (const { personId, live } of observed.duplicateInvitations) {
    problems.push(
      `person ${personId} holds ${live} live invitations to one comp and role, and an invitation ` +
        "is spent once. A human must decide which one stands before either is accepted.",
    );
  }

  return problems;
};

/**
 * The comms half. A sent email cannot be voided, so this is the only subsystem where the doctor is
 * reporting on something the product cannot take back — which is why a stuck message is named here
 * rather than swept up by a retry.
 */
const commsProblems = (observed: Observed): string[] => {
  const problems: string[] = [];

  if (!observed.commsGuaranteeEnforced) {
    problems.push(
      "a message can still be queued twice, or end twice: the comms constraints are missing. " +
        "Apply the migrations with 'bun run db:migrate'.",
    );
  }

  for (const { messageId, state, head } of observed.driftingMessages) {
    problems.push(
      `message ${messageId} is cached as ${state} but its own history ends at ${head}. The chain ` +
        "is the record; a human must decide what actually happened before trusting either.",
    );
  }

  for (const { messageId, minutes } of observed.stuckMessages) {
    problems.push(
      `message ${messageId} has been sending for ${minutes} minutes. It was claimed and never ` +
        "resolved, which is what a send that succeeded and then crashed looks like — so it is not " +
        "retried automatically. A human must check whether it arrived before releasing it.",
    );
  }

  return problems;
};

/**
 * The order to switch comms on in, and it is not stylistic.
 *
 * `recordingTransport.send` returns `{ ok: true }`, so a sweep against an unconfigured host takes the
 * *success* branch: the row lands `sent` with a null `provider_ref` and `scrubPayload` destroys the
 * raw invitation link (ADR-0021). `messages_comp_dedupe_unique` then refuses a re-enqueue, and
 * `enqueue` returns `duplicate` — which by design is not an error and shows a board *already sent*.
 * Permanently marked sent, credential destroyed, unsendable, having reached nobody.
 *
 * Stated up front rather than only detected afterwards, because there is no `revoked_at` on
 * somebody's inbox and a detector that fires after the fact is worth less than a sentence read while
 * the operator is still choosing.
 */
const SENDING_ORDER =
  "if you configure comms, set RESEND_API_KEY and COMMS_FROM first, then NEXT_PUBLIC_BASE_URL, " +
  "then CRON_SECRET last. In that order because a sweep against a host that cannot send still " +
  "marks every queued message sent, scrubs the invitation links out of the payloads, and the " +
  "dedupe index then refuses to queue any of them again.";

const configCaveats = (config: ConfigObserved): string[] => {
  const caveats: string[] = [];

  if (config.sending === "off") {
    caveats.push(
      "nothing sent from this host leaves the building: RESEND_API_KEY and COMMS_FROM are unset, " +
        "so the transport records instead. Every message still queues, and the screens now say so.",
    );
  }

  if (!config.cron) {
    caveats.push(
      "the outbox is never swept: CRON_SECRET is unset, so /api/cron/send answers 503 to everyone. " +
        "Queued messages accumulate and nothing claims them.",
    );
  }

  if (!config.baseUrl && config.sending !== "on") {
    caveats.push(
      "NEXT_PUBLIC_BASE_URL is unset, so invitation links would be relative and an announcement " +
        "would carry no opt-out. Harmless only because this host cannot send.",
    );
  }

  if (config.drive === "off") {
    caveats.push(
      "Drive import is off: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are unset, so the import " +
        "screen says it is not configured rather than starting a handshake it cannot finish.",
    );
  }

  if (config.sealing === "off") {
    caveats.push(
      "DRIVE_TOKEN_KEY is unset, so connecting a Google account is refused rather than storing a " +
        "refresh token in the clear. That is the correct default, not a fault.",
    );
  }

  // Only on a clean slate. Once `cron` is set the ordering has already been decided, and the hazard
  // below is the sentence that matters -- repeating this one under it would bury the recovery.
  if (config.sending === "off" && !config.cron) caveats.push(SENDING_ORDER);

  return caveats;
};

const configHazards = (config: ConfigObserved): string[] => {
  const hazards: string[] = [];

  if (config.sending === "partial") {
    hazards.push(
      `sending is half-configured — ${config.sendingMissing.join(" and ")} ` +
        `${config.sendingMissing.length === 1 ? "is" : "are"} unset, so the transport records ` +
        "instead of sending while the other variable sits there looking configured. Set it, or " +
        "unset both.",
    );
  }

  // The destructive one. Every other entry here describes something not working; this describes
  // something working exactly as built, in an order that cannot be undone.
  if (config.cron && config.sending !== "on") {
    hazards.push(
      "CRON_SECRET is set while RESEND_API_KEY and COMMS_FROM are not, which is the one " +
        "combination that destroys mail. The next sweep will claim everything queued, send it " +
        "through a transport that sends nothing, mark it sent, scrub the invitation links out of " +
        "the payloads, and the dedupe index will then refuse to queue any of it again — reaching " +
        "nobody, permanently. Unset CRON_SECRET until sending is configured.",
    );
  }

  if (!config.baseUrl && config.sending === "on") {
    hazards.push(
      "this host can send and cannot form an opt-out URL: NEXT_PUBLIC_BASE_URL is unset, so an " +
        "announcement ships with no way out of it at all — not only the List-Unsubscribe header, " +
        "none, because the visible line and the header come off one field so that they cannot " +
        "disagree. Set NEXT_PUBLIC_BASE_URL before broadcasting anything.",
    );
  }

  if (config.drive === "partial") {
    hazards.push(
      `Drive import is set up and unusable — ${config.driveMissing.join(" and ")} ` +
        `${config.driveMissing.length === 1 ? "is" : "are"} unset, so the import screen reports ` +
        "'not configured' while the other Google variables are plainly there.",
    );
  }

  if (config.sealing === "unusable") {
    hazards.push(
      `DRIVE_TOKEN_KEY is set but decodes to ${config.sealingKeyBytes} bytes, not 32, so ` +
        "aes-256-gcm cannot use it and connecting a Google account is refused as though the key " +
        "were absent. Generate one with randomBytes(32).toString('base64').",
    );
  }

  return hazards;
};

export const summarizeConfig = (config: ConfigObserved): ConfigVerdict => ({
  caveats: configCaveats(config),
  hazards: configHazards(config),
  source: config.source,
});

/**
 * What `/api/health` puts on the wire, and the one definition of it — the route writes this shape
 * and `db:doctor --host` reads it, so a field renamed on one side is a compile error on the other.
 *
 * `source` is deliberately absent: the answer's subject is the host that answered, which the caller
 * already knows and the responder cannot be trusted to state.
 */
export type HealthPayload = {
  migrations: { applied: number | null; expected: number };
  config: Omit<ConfigObserved, "source">;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);

/**
 * Parsed rather than cast, because this arrives over a network from a host the CLI was pointed at by
 * hand. A cast would let a typo'd URL answering some other JSON produce a confident verdict about a
 * machine that is not this product — which is the failure mode the whole `--host` flag exists to
 * fix, arriving through the flag itself.
 */
export const parseHealthPayload = (value: unknown): HealthPayload | null => {
  if (!isRecord(value)) return null;

  const { migrations, config } = value;
  if (!isRecord(migrations) || !isRecord(config)) return null;

  const { applied, expected } = migrations;
  if (applied !== null && typeof applied !== "number") return null;
  if (typeof expected !== "number") return null;

  if (!isOneOf(config.sending, ["on", "off", "partial"] as const)) return null;
  if (!isOneOf(config.drive, ["on", "off", "partial"] as const)) return null;
  if (!isOneOf(config.sealing, ["on", "off", "unusable"] as const)) return null;
  if (!isStringArray(config.sendingMissing) || !isStringArray(config.driveMissing)) return null;
  if (typeof config.cron !== "boolean" || typeof config.baseUrl !== "boolean") return null;
  if (config.sealingKeyBytes !== null && typeof config.sealingKeyBytes !== "number") return null;

  return {
    migrations: { applied, expected },
    config: {
      sending: config.sending,
      sendingMissing: config.sendingMissing,
      cron: config.cron,
      baseUrl: config.baseUrl,
      drive: config.drive,
      driveMissing: config.driveMissing,
      sealing: config.sealing,
      sealingKeyBytes: config.sealingKeyBytes,
    },
  };
};

export const summarizeHealth = (
  observed: Observed,
  expected: { judges: number; teams: number },
): DemoHealth => {
  const config = summarizeConfig(observed.config);
  if (!observed.compFound) {
    return {
      ok: false,
      problems: [
        ...schemaProblems(observed),
        ...chainProblems(observed),
        ...moneyProblems(observed),
        ...accountProblems(observed),
        ...commsProblems(observed),
        "comp not seeded — run 'bun run db:seed'",
      ],
      config,
    };
  }

  const problems: string[] = [
    ...schemaProblems(observed),
    ...chainProblems(observed),
    ...moneyProblems(observed),
    ...accountProblems(observed),
    ...commsProblems(observed),
  ];

  if (observed.boardAssignments === 0) {
    problems.push(`no board link for the demo comp — ${RESEED}`);
  } else if (!observed.boardViewLoaded) {
    problems.push(`board view failed to load — ${RESEED}`);
  }

  if (observed.judges < expected.judges) {
    problems.push(`only ${observed.judges} of ${expected.judges} judges resolve — ${RESEED}`);
  } else if (!observed.judgeViewLoaded) {
    problems.push(`judge view failed to load — ${RESEED}`);
  }

  // A judge with no label has no de-identified name for the board's export to use. Every board
  // surface that carries a score takes the label, so this is the demo failing closed rather than
  // falling back to a name -- but it fails closed mid-call, which is what the preflight is for.
  if (observed.judgeLabels < expected.judges) {
    problems.push(
      `only ${observed.judgeLabels} of ${expected.judges} judges have a Judge N label — ${RESEED}`,
    );
  }

  if (observed.teams < expected.teams) {
    problems.push(`only ${observed.teams} of ${expected.teams} teams seeded — ${RESEED}`);
  }

  if (problems.length > 0) return { ok: false, problems, config };
  return {
    ok: true,
    board: observed.boardName ?? "",
    judges: observed.judges,
    teams: observed.teams,
    config,
  };
};
