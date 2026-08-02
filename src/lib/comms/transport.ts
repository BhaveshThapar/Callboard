/**
 * The last hop, and the only part of the comms engine that touches a network.
 *
 * One method, on purpose. A provider is a swap rather than a rewrite (ADR-0020), and keeping the
 * interface this thin is what makes that true: everything a board actually depends on — that a
 * message sends once, that a failure is retryable, that a bounce is not — lives in the outbox and
 * the chain, above this line.
 */
export type Sendable = {
  to: string;
  subject: string;
  /** Plain text. No HTML, no tracking pixel, no click wrapper — see ADR-0020's last paragraph. */
  body: string;
  /** Set on broadcast mail only, so a mail client can offer one-click unsubscribe. */
  unsubscribeUrl?: string;
};

/**
 * `retryable` is the whole reason this is not just `ok: boolean`.
 *
 * A refused connection and a rejected address are both failures and must not be treated the same:
 * one becomes `failed` and is tried again, the other becomes `bounced` and never is. Asking the
 * transport to make that call is right, because only it knows what the provider said.
 */
export type SendResult =
  | { ok: true; providerRef: string | null }
  | { ok: false; retryable: boolean; detail: string };

export type Transport = {
  readonly name: string;
  send: (message: Sendable) => Promise<SendResult>;
};

/**
 * The default, and what runs in development and in every test.
 *
 * **Not a mock.** The outbox is the product; only this last hop differs, so an e2e asserting that
 * exactly one message was produced is asserting about the real thing. It also means a test can never
 * email a real person, which is not a hypothetical risk when the fixtures contain addresses.
 */
export const recordingTransport = (): Transport => ({
  name: "recording",
  send: async () => ({ ok: true, providerRef: null }),
});

/**
 * Resend, chosen for ADR-0020's reasons: one HTTP call, no SDK, nothing to add to `package.json`.
 *
 * A 4xx is the request being wrong — a malformed address, a domain that is not verified — and is
 * **not** retried, because the sixth identical attempt fails identically. A 5xx or a thrown fetch is
 * the network, and is.
 */
export const resendTransport = (apiKey: string, from: string): Transport => ({
  name: "resend",
  send: async (message) => {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.body,
          ...(message.unsubscribeUrl
            ? {
                headers: {
                  "List-Unsubscribe": `<${message.unsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              }
            : {}),
        }),
      });

      if (response.ok) {
        const body = (await response.json()) as { id?: string };
        return { ok: true, providerRef: body.id ?? null };
      }

      const detail = `${response.status} ${(await response.text()).slice(0, 300)}`;
      return { ok: false, retryable: response.status >= 500 || response.status === 429, detail };
    } catch (error) {
      // A thrown fetch is DNS, TLS or a socket — always the network, always worth another tick.
      return {
        ok: false,
        retryable: true,
        detail: error instanceof Error ? error.message : "fetch failed",
      };
    }
  },
});

/**
 * Which transport this process uses.
 *
 * **Sending is opt-in**, and that ordering is deliberate: the failure mode of getting it backwards
 * is a preview deployment mailing a real board. So it takes a key *and* an explicit from-address,
 * and anything less records instead of sending.
 */
export const transportFromEnv = (): Transport => {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.COMMS_FROM;
  return key && from ? resendTransport(key, from) : recordingTransport();
};
