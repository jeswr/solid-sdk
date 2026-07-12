// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { buildAgentPointer } from "../src/pointer.js";
import { HAS_AUTHORIZATION_AGENT, SCHEMA_AGENT } from "../src/vocab.js";

const WEBID = "https://alice.pod.example/profile/card#me";
const AGENT = "https://alice.pod.example/agent";

describe("buildAgentPointer — validation", () => {
  it("throws without a webId", () => {
    expect(() => buildAgentPointer("", AGENT)).toThrow(/webId is required/);
  });
  it("throws without an agent", () => {
    expect(() => buildAgentPointer(WEBID, "")).toThrow(/agent IRI is required/);
  });
  it("throws on an empty predicate array", () => {
    expect(() => buildAgentPointer(WEBID, AGENT, [])).toThrow(/at least one predicate/);
  });
});

describe("buildAgentPointer — quads + serialisation", () => {
  it("defaults to interop:hasAuthorizationAgent", async () => {
    const ptr = buildAgentPointer(WEBID, AGENT);
    expect(ptr.quads).toHaveLength(1);
    const q = ptr.quads[0];
    expect(q?.subject.value).toBe(WEBID);
    expect(q?.predicate.value).toBe(HAS_AUTHORIZATION_AGENT);
    expect(q?.object.value).toBe(AGENT);
    expect(q?.object.termType).toBe("NamedNode");
    const ttl = await ptr.toString();
    expect(ttl).toContain("interop:hasAuthorizationAgent");
    expect(ttl).toContain(`<${AGENT}>`);
  });

  it("supports schema:agent", async () => {
    const ptr = buildAgentPointer(WEBID, AGENT, "schema:agent");
    expect(ptr.quads[0]?.predicate.value).toBe(SCHEMA_AGENT);
    expect(await ptr.toString()).toContain("schema:agent");
  });

  it("emits both predicates when given an array", () => {
    const ptr = buildAgentPointer(WEBID, AGENT, ["interop:hasAuthorizationAgent", "schema:agent"]);
    const preds = ptr.quads.map((q) => q.predicate.value).sort();
    expect(preds).toEqual([SCHEMA_AGENT, HAS_AUTHORIZATION_AGENT].sort());
  });

  it("de-dupes a repeated predicate", () => {
    const ptr = buildAgentPointer(WEBID, AGENT, [
      "interop:hasAuthorizationAgent",
      "interop:hasAuthorizationAgent",
    ]);
    expect(ptr.quads).toHaveLength(1);
  });

  it("serialises to N-Triples too", async () => {
    const ptr = buildAgentPointer(WEBID, AGENT);
    const nt = await ptr.toString("application/n-triples");
    expect(nt).toContain(`<${WEBID}>`);
    expect(nt).toContain(`<${HAS_AUTHORIZATION_AGENT}>`);
    expect(nt).not.toContain("@prefix");
  });
});
