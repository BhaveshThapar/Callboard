import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Imported after dotenv, because `@/db` reads DATABASE_URL when it loads.
const { db } = await import("@/db");
const { comps, messageEvents, messages, orgs, people } = await import("@/db/schema");
const { and, desc, eq } = await import("drizzle-orm");
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
  .select({ id: comps.id })
  .from(comps)
  .innerJoin(orgs, eq(orgs.id, comps.orgId))
  .where(eq(comps.slug, compSlug))
  .limit(1);
if (!comp) throw new Error(`no comp ${compSlug}`);

const somebody = async (): Promise<string> => {
  const [row] = await db.select({ id: people.id }).from(people).limit(1);
  if (!row) throw new Error("no people seeded");
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
