// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import {
  type Confirmation,
  parseConfirmation,
  serializeConfirmation,
} from "./confirmation-store.js";
import { proposalContentDigest } from "./digest.js";
import type { ActionProposal } from "./proposals.js";

const URL = "https://pod.example/agent/confirmations/p1.ttl";

const proposal: ActionProposal = {
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
};

const confirmation: Confirmation = {
  proposalId: "p1",
  contentDigest: proposalContentDigest(proposal),
  confirmedAt: "2026-07-06T01:00:00Z",
};

describe("confirmation record serialize/parse", () => {
  it("round-trips a confirmation", async () => {
    const ttl = await serializeConfirmation(confirmation, URL);
    const store = await parseRdf(ttl, "text/turtle", { baseIRI: URL });
    const back = parseConfirmation(store);
    expect(back?.proposalId).toBe("p1");
    expect(back?.contentDigest).toBe(confirmation.contentDigest);
    expect(back?.confirmedAt).toContain("2026-07-06T01:00:00");
  });

  it("throws (fail-closed) on a malformed content digest", () => {
    expect(() =>
      serializeConfirmation({ ...confirmation, contentDigest: "not-a-digest" }, URL),
    ).toThrow();
  });

  it("returns undefined for a graph that is not a confirmation", async () => {
    const store = await parseRdf("<https://x/a> <https://x/b> <https://x/c> .", "text/turtle", {
      baseIRI: URL,
    });
    expect(parseConfirmation(store)).toBeUndefined();
  });

  it("returns undefined when the digest is tampered to a non-canonical shape", async () => {
    let ttl = await serializeConfirmation(confirmation, URL);
    ttl = ttl.replace(/sha256:[0-9a-f]{64}/, "sha256:zzz");
    const store = await parseRdf(ttl, "text/turtle", { baseIRI: URL });
    expect(parseConfirmation(store)).toBeUndefined();
  });
});
