// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import type { ActionProposal } from "../pod/proposals.js";
import { classifyFriction, confirmProposal, rejectProposal } from "./confirm.js";

const AT = "2026-07-06T01:00:00Z";

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
  it("LOW friction: a simple confirm suffices", () => {
    const confirmed = confirmProposal(proposal(), { confirm: true, confirmedAt: AT });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confirmedAt).toBe(AT);
  });

  it("LOW friction: no acknowledgement at all throws", () => {
    expect(() => confirmProposal(proposal(), { confirmedAt: AT })).toThrow();
  });

  it("HIGH friction: a one-tap confirm is NOT enough — requires the recipient typed back", () => {
    const high = proposal({ friction: "high" });
    expect(() => confirmProposal(high, { confirm: true, confirmedAt: AT })).toThrow();
    expect(() =>
      confirmProposal(high, { typedAcknowledgement: "wrong@x.com", confirmedAt: AT }),
    ).toThrow();
    const confirmed = confirmProposal(high, {
      typedAcknowledgement: "alice@example.com",
      confirmedAt: AT,
    });
    expect(confirmed.status).toBe("confirmed");
  });

  it("cannot confirm a non-pending proposal", () => {
    expect(() =>
      confirmProposal(proposal({ status: "executed" }), { confirm: true, confirmedAt: AT }),
    ).toThrow();
    expect(() =>
      confirmProposal(proposal({ status: "confirmed" }), { confirm: true, confirmedAt: AT }),
    ).toThrow();
  });

  it("rejectProposal marks it rejected", () => {
    expect(rejectProposal(proposal(), "not now").status).toBe("rejected");
  });

  it("classifyFriction: a novel recipient (no thread) or any spend is HIGH", () => {
    expect(classifyFriction(proposal({ inReplyTo: undefined }))).toBe("high");
    expect(classifyFriction(proposal({ spend: 3 }))).toBe("high");
    expect(classifyFriction(proposal())).toBe("low");
  });
});
