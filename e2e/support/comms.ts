import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `@/db` reads DATABASE_URL when it loads.
const { db } = await import("@/db");
const { comps, messageEvents, messages, orgs, people } = await import("@/db/schema");
const { and, desc, eq, isNotNull, isNull } = await import("drizzle-orm");
const { enqueue, sweep } = await import("@/lib/comms/outbox");

/**
 * Drives the outbox from outside the product, so a spec can assert about what *would* be sent.
 *
 * The transport is the recording one — nothing leaves the machine — and that is not a mock: the
 * outbox is the product and only the last hop differs (ADR-0020). It also means a test can never
 * email a real person, which stops being hypothetical the moment a fixture contains an address.
 *
 * `enqueue` is called here rather than through a screen because the thing under test is the
 * *guarantee*, and the guarantee is a database index. A second click on a button proves the button
 * is debounced; two calls that race prove the index refuses one.
 */
const [command, compSlug, ...rest] = process.argv.slice(2);
if (!command || !compSlug) {
  throw new Error("usage: comms.ts <queue|queue-twice|sweep|count|states> <compSlug> [args]");
}

const [comp] = await db
  .select({ id: comps.id, orgId: comps.orgId })
  .from(comps)
  .innerJoin(orgs, eq(orgs.id, comps.orgId))
  .where(eq(comps.slug, compSlug))
  .limit(1);
if (!comp) throw new Error(`no comp ${compSlug}`);

/**
 * One person, and always the same one.
 *
 * Both halves matter and both were wrong. **Scoped to this comp's org**, because `people` is
 * org-scoped and survives a comp being replaced — an unscoped pick returns somebody another spec
 * seeded, so the run marks one person unsubscribed and queues a message to a different one. And
 * **ordered**, because `limit(1)` without an `ORDER BY` lets Postgres return a different row per
 * call, which turns the same mismatch into a coin flip that only shows up in a full suite.
 *
 * Passing alone and failing in a run of 92 is the signature of exactly this, and it is a bug in the
 * fixture rather than in the product.
 */
const somebody = async (): Promise<string> => {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    // Reachable, because a person with no address is a *different* test -- the sweep bounces those
    // with "no email address on file", which is right and which quietly turned every assertion in
    // this file into an assertion about suppression instead of about sending.
    .where(and(eq(people.orgId, comp.orgId), isNotNull(people.email)))
    .orderBy(people.createdAt, people.id)
    .limit(1);
  if (!row) throw new Error(`nobody in the org behind ${compSlug} has an email address`);
  return row.id;
};

const payload = {
  teamName: "Accepted Beta",
  compName: "Comms E2E 2027",
  balance: "$2,200.00",
  lines: [{ kind: "registration", amount: "$1,400.00", paid: "unpaid" }],
  boardName: "Comms Chair",
} as const;

switch (command) {
  /** Queues one, twice, with one key. The second must be refused by the index, not by a check. */
  case "queue-twice": {
    const personId = await somebody();
    const key = rest[0] ?? "dues:test";
    const first = await enqueue({
      compId: comp.id,
      personId,
      template: "dues.reminder",
      payload,
      dedupeKey: key,
    });
    const second = await enqueue({
      compId: comp.id,
      personId,
      template: "dues.reminder",
      payload,
      dedupeKey: key,
    });
    console.log(`${first.ok ? "queued" : first.reason}:${second.ok ? "queued" : second.reason}`);
    break;
  }

  case "sweep": {
    const result = await sweep(50);
    console.log(`${result.claimed} ${result.sent} ${result.failed} ${result.skipped}`);
    break;
  }

  case "count": {
    const rows = await db.select({ id: messages.id }).from(messages).where(eq(messages.compId, comp.id));
    console.log(String(rows.length));
    break;
  }

  /** The chain, head last, so a spec can assert the whole history rather than only its end. */
  case "states": {
    const rows = await db
      .select({ state: messageEvents.state, seq: messageEvents.seq })
      .from(messageEvents)
      .innerJoin(messages, eq(messages.id, messageEvents.messageId))
      .where(eq(messages.compId, comp.id))
      .orderBy(messageEvents.seq);
    console.log(rows.map((row) => row.state).join(","));
    break;
  }

  /**
   * Who the outbox is addressed to, and what each message claims they owe.
   *
   * A count proves something was queued; this proves the *right* person was queued for the *right*
   * number, which is the only version of A10 worth having — a reminder naming the wrong balance is
   * the failure this product is sold against, with a stamp on it.
   */
  case "recipients": {
    const balanceOf = (payload: unknown): string =>
      typeof payload === "object" && payload !== null && "balance" in payload
        ? String((payload as Record<string, unknown>).balance)
        : "";

    const rows = await db
      .select({ template: messages.template, email: people.email, payload: messages.payload })
      .from(messages)
      .innerJoin(people, eq(people.id, messages.personId))
      .where(eq(messages.compId, comp.id))
      .orderBy(people.email);

    console.log(
      rows.map((row) => `${row.template} ${row.email} ${balanceOf(row.payload)}`).join("\n"),
    );
    break;
  }

  /** How many times the sweep actually handed something to a transport. */
  case "sent": {
    const rows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.compId, comp.id), eq(messages.state, "sent")));
    console.log(String(rows.length));
    break;
  }

  case "unsubscribe": {
    const personId = await somebody();
    await db.update(people).set({ unsubscribedAt: new Date() }).where(eq(people.id, personId));
    console.log(personId);
    break;
  }

  /** Queues a broadcast, which an unsubscribe must suppress and a transactional one must not. */
  case "queue-broadcast": {
    const personId = await somebody();
    const result = await enqueue({
      compId: comp.id,
      personId,
      template: "announcement.sent",
      payload: {
        compName: "Comms E2E 2027",
        subject: "Bus times",
        body: "The bus leaves at seven.",
        boardName: "Comms Chair",
      },
      dedupeKey: rest[0] ?? "announce:test",
    });
    console.log(result.ok ? "queued" : result.reason);
    break;
  }

  /**
   * Queues to somebody with **no address**, which a seeded board member without an email is. The
   * sweep must bounce it rather than throw or send nothing quietly.
   */
  case "queue-unreachable": {
    const [row] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.orgId, comp.orgId), isNull(people.email)))
      .orderBy(people.createdAt, people.id)
      .limit(1);
    if (!row) throw new Error(`everybody in the org behind ${compSlug} has an address`);

    const result = await enqueue({
      compId: comp.id,
      personId: row.id,
      template: "dues.reminder",
      payload,
      dedupeKey: rest[0] ?? "dues:unreachable",
    });
    console.log(result.ok ? "queued" : result.reason);
    break;
  }

  /** The head state of the most recent message, which is what a suppression test asserts on. */
  case "head": {
    const [row] = await db
      .select({ state: messages.state })
      .from(messages)
      .where(eq(messages.compId, comp.id))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    console.log(row?.state ?? "none");
    break;
  }

  default:
    throw new Error(`unknown command: ${command}`);
}
