// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import {
  AGENT_POINTER_PREDICATES,
  ANP_AD,
  ANP_INLINE_CONTEXT,
  HAS_AUTHORIZATION_AGENT,
  SCHEMA_AGENT,
  SECURITY_SCHEME_TYPES,
  VALID_SECURITY_SCHEME_TYPES,
  WELL_KNOWN_AGENT_CARD,
  WELL_KNOWN_AGENT_DESCRIPTIONS,
} from "../src/vocab.js";

describe("vocab constants", () => {
  it("uses the ANP well-known path (aligned, not bespoke)", () => {
    expect(WELL_KNOWN_AGENT_DESCRIPTIONS).toBe("/.well-known/agent-descriptions");
  });
  it("uses the A2A agent-card well-known path", () => {
    expect(WELL_KNOWN_AGENT_CARD).toBe("/.well-known/agent-card.json");
  });
  it("prioritises interop:hasAuthorizationAgent over schema:agent", () => {
    expect(AGENT_POINTER_PREDICATES[0]).toBe(HAS_AUTHORIZATION_AGENT);
    expect(AGENT_POINTER_PREDICATES).toContain(SCHEMA_AGENT);
  });
  it("derives the valid security-scheme set from the type list", () => {
    expect([...VALID_SECURITY_SCHEME_TYPES].sort()).toEqual([...SECURITY_SCHEME_TYPES].sort());
    expect(VALID_SECURITY_SCHEME_TYPES.has("solid-oidc")).toBe(true);
    expect(VALID_SECURITY_SCHEME_TYPES.has("nonsense")).toBe(false);
  });
  it("inline JSON-LD context maps every term under the ad: namespace", () => {
    expect(ANP_INLINE_CONTEXT.ad).toBe(ANP_AD);
    expect(ANP_INLINE_CONTEXT.AgentDescription).toBe(`${ANP_AD}AgentDescription`);
    // IRI-valued terms carry @type:@id so { @id } parses as a node.
    expect(ANP_INLINE_CONTEXT.owner).toEqual({ "@id": `${ANP_AD}owner`, "@type": "@id" });
  });
});

describe("public API surface", () => {
  it("exports the documented functions", () => {
    for (const name of [
      "describeAgent",
      "buildAgentPointer",
      "discoverAgent",
      "verifyDescriptor",
      "verifyDataset",
      "serialize",
      "agentDescriptionsUrl",
      "agentCardUrl",
    ]) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe("function");
    }
  });
  it("exports the vocab constants", () => {
    expect(api.WELL_KNOWN_AGENT_DESCRIPTIONS).toBe(WELL_KNOWN_AGENT_DESCRIPTIONS);
    expect(api.HAS_AUTHORIZATION_AGENT).toBe(HAS_AUTHORIZATION_AGENT);
    expect(api.ANP_INLINE_CONTEXT).toBe(ANP_INLINE_CONTEXT);
  });
});
