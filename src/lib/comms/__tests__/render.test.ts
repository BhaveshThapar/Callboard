import { describe, expect, it } from "vitest";
import {
  render,
  SCRUBBED,
  SCRUBBED_FIELDS,
  scrubPayload,
  TEMPLATE_KIND,
  TEMPLATE_NAMES,
  unsubscribeUrlOf,
} from "../render";

const ANNOUNCEMENT = {
  compName: "Mayuri 2027",
  subject: "Load-in moved to 7:30",
  body: "Doors at 7:30, not 8. Park in Lot 4.",
  boardName: "Ananya Krishnan",
  unsubscribeUrl: "https://callboard.example/unsubscribe/p3",
};

/**
 * ADR-0021. The outbox has to hold the link it is going to send, and must stop holding it the moment
 * it has sent it — so the scrub is the part that has to be provably right, since nothing downstream
 * would notice a payload that quietly kept its token.
 */
describe("scrubPayload", () => {
  it("replaces the invitation link once it has gone out", () => {
    const scrubbed = scrubPayload("invitation.created", {
      personName: "Priya Raman",
      compName: "Mayuri 2027",
      role: "captain",
      invitedBy: "Ananya Krishnan",
      url: "https://callboard.example/invite/2f0c…",
    });

    expect(scrubbed).toEqual({
      personName: "Priya Raman",
      compName: "Mayuri 2027",
      role: "captain",
      invitedBy: "Ananya Krishnan",
      url: SCRUBBED,
    });
  });

  /**
   * Replaced, not deleted. A missing key leaves the stored row failing its own payload type, so a
   * replay a season later renders `undefined` into a sentence somebody supposedly read.
   */
  it("keeps the key, so a replay says what happened instead of going blank", () => {
    const scrubbed = scrubPayload("invitation.created", { url: "https://x/invite/tok" }) as {
      url: string;
    };

    expect(Object.keys(scrubbed)).toContain("url");
    expect(scrubbed.url).not.toContain("tok");
  });

  it("returns the same payload untouched for a template with nothing to hide", () => {
    const payload = { teamName: "NCSU Nazaare", compName: "Mayuri 2027" };
    // The identity matters, not just the value: the caller writes no `payload` column when nothing
    // changed, which is what keeps every other template's send one statement.
    expect(scrubPayload("payment.receipt", payload)).toBe(payload);
  });

  it("survives a template name that no longer exists, because it arrives from a stored row", () => {
    const payload = { url: "https://x/invite/tok" };
    expect(scrubPayload("invitation.created.v0", payload)).toBe(payload);
  });

  it("survives a payload that is not an object", () => {
    expect(scrubPayload("invitation.created", null)).toBeNull();
    expect(scrubPayload("invitation.created", "not a payload")).toBe("not a payload");
  });

  /**
   * The list is the one place a reader would look, so a template added later with a credential in it
   * and nothing here is the leak. Asserted rather than trusted.
   */
  it("scrubs exactly the template that carries a credential", () => {
    expect(Object.keys(SCRUBBED_FIELDS)).toEqual(["invitation.created"]);
  });
});

describe("the announcement's way out", () => {
  it("writes the opt-out into the body, not only into a header", () => {
    const { body } = render("announcement.sent", ANNOUNCEMENT);

    expect(body).toContain("https://callboard.example/unsubscribe/p3");
    expect(body).toContain("Stop receiving announcements");
    // Said out loud, because somebody clicking it is entitled to know what it does not cover.
    expect(body).toContain("Receipts and anything you owe still reach you.");
  });

  it("says nothing about unsubscribing when it has no link to offer", () => {
    const { body } = render("announcement.sent", { ...ANNOUNCEMENT, unsubscribeUrl: null });

    expect(body).not.toContain("Stop receiving announcements");
    expect(body).toContain("Doors at 7:30");
  });

  /** The header and the visible line are the same string, off the same field. */
  it("hands the transport the link the body printed", () => {
    expect(unsubscribeUrlOf(ANNOUNCEMENT)).toBe("https://callboard.example/unsubscribe/p3");
  });

  it("finds no link on a payload written before the field existed", () => {
    expect(unsubscribeUrlOf({ compName: "Mayuri 2027" })).toBeNull();
    expect(unsubscribeUrlOf({ unsubscribeUrl: "" })).toBeNull();
    expect(unsubscribeUrlOf(null)).toBeNull();
  });

  /**
   * A transactional message must never carry one. A dues reminder is owed whether or not somebody
   * wants to hear from the board, and offering an opt-out beside a bill is a promise the product
   * deliberately does not keep.
   */
  it("is offered by the broadcast template and no other", () => {
    const withOptOut = TEMPLATE_NAMES.filter((name) => TEMPLATE_KIND[name] === "broadcast");
    expect(withOptOut).toEqual(["announcement.sent"]);
  });
});
