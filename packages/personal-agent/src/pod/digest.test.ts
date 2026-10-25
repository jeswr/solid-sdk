// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { proposalContentDigest } from "./digest.js";
import type { ActionProposal } from "./proposals.js";

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

describe("proposalContentDigest", () => {
  it("is stable for identical content", () => {
    expect(proposalContentDigest(proposal())).toBe(proposalContentDigest(proposal()));
    expect(proposalContentDigest(proposal())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when any send-affecting field changes", () => {
    const base = proposalContentDigest(proposal());
    expect(proposalContentDigest(proposal({ recipient: "bob@example.com" }))).not.toBe(base);
    expect(proposalContentDigest(proposal({ bodyText: "different" }))).not.toBe(base);
    expect(proposalContentDigest(proposal({ odrlAction: "read" }))).not.toBe(base);
    expect(proposalContentDigest(proposal({ confirmationRequired: true }))).not.toBe(base);
    expect(proposalContentDigest(proposal({ spend: 1 }))).not.toBe(base);
    expect(proposalContentDigest(proposal({ derivedFrom: "urn:agentic:raw:other" }))).not.toBe(
      base,
    );
    expect(
      proposalContentDigest(proposal({ offeredTimes: [{ startTime: "2026-07-07T14:00:00Z" }] })),
    ).not.toBe(base);
  });

  it("is INJECTIVE across embedded delimiters/newlines (no field-shift collision)", () => {
    // A delimiter-joined form could let a crafted body impersonate other fields; JSON cannot.
    const a = proposalContentDigest(proposal({ bodyText: "a", subject: "b" }));
    const b = proposalContentDigest(proposal({ bodyText: 'a","subject":"b', subject: "" }));
    const c = proposalContentDigest(proposal({ bodyText: "a\nsubject=b", subject: "" }));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
    // Hostile delimiter soup still hashes cleanly.
    expect(proposalContentDigest(proposal({ bodyText: '|;\n"{}][,:' }))).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  it("is order-independent over offered times (a reorder is the same content)", () => {
    const t1 = { startTime: "2026-07-07T14:00:00Z" };
    const t2 = { startTime: "2026-07-08T10:00:00Z" };
    expect(proposalContentDigest(proposal({ offeredTimes: [t1, t2] }))).toBe(
      proposalContentDigest(proposal({ offeredTimes: [t2, t1] })),
    );
  });
});
