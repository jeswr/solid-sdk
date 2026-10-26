// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import { AGENTIC_PURPOSE_SCHEDULING } from "../vocab.js";
import { type ActionProposal, parseProposal, serializeProposal } from "./proposals.js";

const URL = "https://pod.example/agent/proposals/p1.ttl";

function proposal(over: Partial<ActionProposal> = {}): ActionProposal {
  return {
    id: "p1",
    channel: "email",
    recipient: "alice@example.com",
    odrlAction: "distribute",
    purpose: AGENTIC_PURPOSE_SCHEDULING,
    spend: 0,
    status: "pending",
    friction: "low",
    bodyText: "Can we meet?",
    subject: "Re: meeting",
    inReplyTo: "urn:agentic:raw:abc123",
    derivedFrom: "urn:agentic:raw:abc123",
    offeredTimes: [{ startTime: "2026-07-07T14:00:00Z", endTime: "2026-07-07T14:30:00Z" }],
    proposedAt: "2026-07-06T09:00:00Z",
    ...over,
  };
}

async function roundTrip(p: ActionProposal): Promise<ActionProposal | undefined> {
  const ttl = await serializeProposal(p, { resourceUrl: URL });
  const store = await parseRdf(ttl, "text/turtle", { baseIRI: URL });
  return parseProposal(store);
}

describe("ActionProposal serialize/parse", () => {
  it("preserves the confirmation-required reliability flag", async () => {
    expect((await roundTrip(proposal({ confirmationRequired: true })))?.confirmationRequired).toBe(
      true,
    );
    expect((await roundTrip(proposal()))?.confirmationRequired).toBeUndefined();
  });

  it("round-trips a full proposal", async () => {
    const back = await roundTrip(proposal());
    expect(back?.id).toBe("p1");
    expect(back?.recipient).toBe("alice@example.com");
    expect(back?.odrlAction).toBe("distribute");
    expect(back?.purpose).toBe(AGENTIC_PURPOSE_SCHEDULING);
    expect(back?.spend).toBe(0);
    expect(back?.status).toBe("pending");
    expect(back?.friction).toBe("low");
    expect(back?.inReplyTo).toBe("urn:agentic:raw:abc123");
    expect(back?.offeredTimes?.[0]?.startTime).toContain("2026-07-07T14:00:00");
    expect(back?.offeredTimes?.[0]?.endTime).toContain("2026-07-07T14:30:00");
  });

  it("throws (fail-closed) on an invalid ODRL action", () => {
    expect(() =>
      serializeProposal(proposal({ odrlAction: "frobnicate" as never }), { resourceUrl: URL }),
    ).toThrow();
  });

  it("throws (fail-closed) on an invalid email recipient", () => {
    expect(() =>
      serializeProposal(proposal({ recipient: "not an email <injected>" }), { resourceUrl: URL }),
    ).toThrow();
  });

  it("drops an unsafe inReplyTo anchor rather than emit an injectable IRI", async () => {
    const back = await roundTrip(proposal({ inReplyTo: 'urn:evil <injected> "x"' }));
    expect(back?.inReplyTo).toBeUndefined();
  });

  it("parses an unknown status IRI fail-closed as pending (never confirmed)", async () => {
    let ttl = await serializeProposal(proposal({ status: "confirmed" }), { resourceUrl: URL });
    ttl = ttl.replace("ProposalConfirmed", "SomethingTampered");
    const store = await parseRdf(ttl, "text/turtle", { baseIRI: URL });
    expect(parseProposal(store)?.status).toBe("pending");
  });

  it("returns undefined for a graph that is not a proposal", async () => {
    const store = await parseRdf("<https://x/a> <https://x/b> <https://x/c> .", "text/turtle", {
      baseIRI: URL,
    });
    expect(parseProposal(store)).toBeUndefined();
  });

  it("returns undefined when the odrlAction is missing (fail-closed — no action to evaluate)", async () => {
    let ttl = await serializeProposal(proposal(), { resourceUrl: URL });
    // Strip the odrlAction triple.
    ttl = ttl
      .split("\n")
      .filter((line) => !line.includes("odrlAction"))
      .join("\n");
    const store = await parseRdf(ttl, "text/turtle", { baseIRI: URL });
    expect(parseProposal(store)).toBeUndefined();
  });
});
