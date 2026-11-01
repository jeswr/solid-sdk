// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import type { ActionProposal } from "../pod/proposals.js";
import { classifyFriction, confirmProposal, type TrustedReplyThread } from "./confirm.js";

const AT = "2026-07-06T01:00:00Z";
// Owner-controlled evidence, supplied independently of Actor-writable proposals.
const THREAD: TrustedReplyThread = {
  inReplyTo: "urn:agentic:raw:abc",
  channel: "email",
  recipients: ["alice@example.com"],
};

function proposal(over: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "p1",
    channel: "email",
    recipient: "alice@example.com",
    odrlAction: "distribute",
    spend: 0,
    status: "pending",
    friction: "low",
    bodyText: "hi",
    proposedAt: "2026-07-06T00:00:00Z",
    inReplyTo: "urn:agentic:raw:abc",
    ...over,
  };
}

describe("confirmProposal — the graduated human-confirm gate", () => {
  it("LOW friction: a simple confirm produces a content-locked confirmation", () => {
    const confirmation = confirmProposal(proposal(), { confirm: true, confirmedAt: AT }, THREAD);
    expect(confirmation.proposalId).toBe("p1");
    expect(confirmation.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(confirmation.confirmedAt).toBe(AT);
  });

  it("LOW friction: no acknowledgement at all throws", () => {
    expect(() => confirmProposal(proposal(), { confirmedAt: AT }, THREAD)).toThrow();
  });

  it.each([
    ["no owner evidence", {}, undefined],
    ["a fabricated reply reference", { inReplyTo: "urn:agentic:raw:forged" }, THREAD],
    ["a novel recipient on a known thread", { recipient: "mallory@example.com" }, THREAD],
    ["a different channel", { channel: "slack" }, THREAD],
    ["no established recipients", {}, { ...THREAD, recipients: [] }],
  ] as const)("requires typed acknowledgement with %s", (_label, changes, evidence) => {
    const intent = proposal(changes);
    expect(classifyFriction(intent, evidence)).toBe("high");
    expect(() => confirmProposal(intent, { confirm: true, confirmedAt: AT }, evidence)).toThrow(
      /recipient typed back/,
    );
    expect(
      confirmProposal(intent, { typedAcknowledgement: intent.recipient, confirmedAt: AT }, evidence)
        .proposalId,
    ).toBe(intent.id);
  });

  it("allows typed acknowledgement on a trusted thread too", () => {
    expect(
      confirmProposal(
        proposal(),
        { typedAcknowledgement: "alice@example.com", confirmedAt: AT },
        THREAD,
      ).proposalId,
    ).toBe("p1");
  });

  it("HIGH friction (recomputed owner-side, not trusted from the proposal): needs the recipient typed", () => {
    // A novel recipient (no thread) is HIGH regardless of what `friction` the Actor wrote.
    const high = proposal({ inReplyTo: undefined, friction: "low" });
    expect(() => confirmProposal(high, { confirm: true, confirmedAt: AT })).toThrow();
    expect(() =>
      confirmProposal(high, { typedAcknowledgement: "wrong@x.com", confirmedAt: AT }),
    ).toThrow();
    expect(
      confirmProposal(high, { typedAcknowledgement: "alice@example.com", confirmedAt: AT })
        .proposalId,
    ).toBe("p1");
  });

  it("the confirmation digest is content-locked (changes when the body changes)", () => {
    const a = confirmProposal(proposal(), { confirm: true, confirmedAt: AT }, THREAD);
    const b = confirmProposal(
      proposal({ bodyText: "a different body" }),
      { confirm: true, confirmedAt: AT },
      THREAD,
    );
    expect(a.contentDigest).not.toBe(b.contentDigest);
  });

  it("classifyFriction: a novel recipient (no thread) or any spend is HIGH", () => {
    expect(classifyFriction(proposal({ inReplyTo: undefined }), THREAD)).toBe("high");
    expect(classifyFriction(proposal({ spend: 3 }), THREAD)).toBe("high");
    expect(classifyFriction(proposal(), THREAD)).toBe("low");
  });
});
