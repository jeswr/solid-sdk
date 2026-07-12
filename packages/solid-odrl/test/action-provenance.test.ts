// AUTHORED-BY Claude Sonnet 5
//
// Unit tests for the per-action PROV activity-bundle emitter
// (src/action-provenance.ts) — the G8 sibling of delegationProvenance.
// Adversarial by design, mirroring test/delegation.test.ts's
// delegationProvenance suite: a valid bundle emits the expected quads, a
// hostile IRI in any field is neutralised (no triple injection) on both the
// RDF and JSON-LD paths, and the two paths escape identically (parity).

import { escapeIri } from "@jeswr/rdf-serialize";
import { describe, expect, it } from "vitest";
import {
  type ActionProvenanceInput,
  actionProvenance,
  actionProvenanceJsonLd,
} from "../src/action-provenance.js";
import { serialize } from "../src/serialize.js";
import {
  PROV_ACTED_ON_BEHALF_OF,
  PROV_ACTIVITY,
  PROV_AGENT,
  PROV_ASSOCIATION,
  PROV_ENDED_AT_TIME,
  PROV_GENERATED,
  PROV_HAD_PLAN,
  PROV_QUALIFIED_ASSOCIATION,
  PROV_STARTED_AT_TIME,
  PROV_USED,
  PROV_WAS_ASSOCIATED_WITH,
  PROV_WAS_DERIVED_FROM,
  PROV_WAS_GENERATED_BY,
  RDF_TYPE,
} from "../src/vocab.js";

const ACTIVITY = "https://agent-a.example/activities/1";
const AGENT = "https://agent-a.example/id#it";
const PRINCIPAL = "https://alice.example/profile/card#me";
const RESOURCE = "https://alice.example/data/records.ttl";
const ARTIFACT = "https://agent-a.example/data/summary.ttl";
const PLAN = "https://agent-a.example/policies/to-b";
const STARTED = new Date("2026-07-01T12:00:00Z");
const ENDED = new Date("2026-07-01T12:05:00Z");

function triples(
  quads: readonly {
    subject: { value: string };
    predicate: { value: string };
    object: { value: string };
  }[],
): string[] {
  return quads.map((q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`);
}

function fullInput(): ActionProvenanceInput {
  return {
    activity: ACTIVITY,
    agent: AGENT,
    onBehalfOf: PRINCIPAL,
    used: [RESOURCE],
    generated: [ARTIFACT],
    plan: PLAN,
    started: STARTED,
    ended: ENDED,
  };
}

describe("actionProvenance", () => {
  it("emits the expected PROV quads for a valid action bundle", () => {
    const quads = actionProvenance(fullInput());
    const t = triples(quads);

    expect(t).toContain(`${ACTIVITY} ${RDF_TYPE} ${PROV_ACTIVITY}`);
    expect(t).toContain(`${ACTIVITY} ${PROV_WAS_ASSOCIATED_WITH} ${AGENT}`);
    expect(t).toContain(`${ACTIVITY} ${PROV_USED} ${RESOURCE}`);
    expect(t).toContain(`${ACTIVITY} ${PROV_GENERATED} ${ARTIFACT}`);
    expect(t).toContain(`${AGENT} ${PROV_ACTED_ON_BEHALF_OF} ${PRINCIPAL}`);
    expect(t).toContain(`${ARTIFACT} ${PROV_WAS_DERIVED_FROM} ${RESOURCE}`);
    expect(t).toContain(`${ARTIFACT} ${PROV_WAS_GENERATED_BY} ${ACTIVITY}`);

    // startedAtTime / endedAtTime literals.
    const started = quads.find(
      (q) => q.subject.value === ACTIVITY && q.predicate.value === PROV_STARTED_AT_TIME,
    );
    expect(started?.object.value).toBe(STARTED.toISOString());
    const ended = quads.find(
      (q) => q.subject.value === ACTIVITY && q.predicate.value === PROV_ENDED_AT_TIME,
    );
    expect(ended?.object.value).toBe(ENDED.toISOString());

    // The reified qualifiedAssociation blank node: type + agent + hadPlan.
    const assocLink = quads.find(
      (q) => q.subject.value === ACTIVITY && q.predicate.value === PROV_QUALIFIED_ASSOCIATION,
    );
    expect(assocLink).toBeDefined();
    expect(assocLink?.object.termType).toBe("BlankNode");
    const assocId = assocLink?.object.value;
    const assocTriples = triples(
      quads.filter((q) => q.subject.value === assocId && q.subject.termType === "BlankNode"),
    );
    expect(assocTriples).toContain(`${assocId} ${RDF_TYPE} ${PROV_ASSOCIATION}`);
    expect(assocTriples).toContain(`${assocId} ${PROV_AGENT} ${AGENT}`);
    expect(assocTriples).toContain(`${assocId} ${PROV_HAD_PLAN} ${PLAN}`);
  });

  it("omits onBehalfOf / endedAtTime / generated-derived triples when not supplied", () => {
    const quads = actionProvenance({
      activity: ACTIVITY,
      agent: AGENT,
      used: [RESOURCE],
      plan: PLAN,
      started: STARTED,
    });
    const preds = new Set(quads.map((q) => q.predicate.value));
    expect(preds.has(PROV_ACTED_ON_BEHALF_OF)).toBe(false);
    expect(preds.has(PROV_ENDED_AT_TIME)).toBe(false);
    expect(preds.has(PROV_GENERATED)).toBe(false);
    expect(preds.has(PROV_WAS_DERIVED_FROM)).toBe(false);
    expect(preds.has(PROV_WAS_GENERATED_BY)).toBe(false);
  });

  it("accepts a bare string for used/generated (not just an array)", () => {
    const quads = actionProvenance({
      activity: ACTIVITY,
      agent: AGENT,
      used: RESOURCE,
      generated: ARTIFACT,
      plan: PLAN,
      started: STARTED,
    });
    const t = triples(quads);
    expect(t).toContain(`${ACTIVITY} ${PROV_USED} ${RESOURCE}`);
    expect(t).toContain(`${ACTIVITY} ${PROV_GENERATED} ${ARTIFACT}`);
  });

  it("neutralises a hostile IRI in the agent — no triple injection into the audit trail (mirrors delegationProvenance's adversarial-verify High)", async () => {
    // n3.Writer emits an IRI verbatim inside <…>; an agent value carrying a `>`
    // + full triple payload would otherwise break out and inject a FORGED
    // prov:wasAssociatedWith triple, framing another principal as the actor.
    // The write path must percent-escape it so the hostile value stays inside
    // ONE object IRI and no extra triples are minted.
    const hostile =
      "https://evil.example/x> <https://victim.example/act> <http://www.w3.org/ns/prov#wasAssociatedWith> <https://framed-victim.example/id#it> .\n<https://evil.example/x";
    const quads = actionProvenance({
      activity: ACTIVITY,
      agent: hostile,
      used: [RESOURCE],
      plan: PLAN,
      started: STARTED,
    });
    const ttl = await serialize(quads);
    // The `>` breakout char survives only percent-escaped inside the object IRI.
    expect(ttl).toContain("%3E");
    // Re-parsing the serialised graph yields EXACTLY the triples we emitted —
    // an injection would add triples (a forged association to the framed
    // victim / a rewritten subject).
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const reparsed = await parseRdf(ttl, "text/turtle");
    expect(reparsed.size).toBe(quads.length);
    for (const q of reparsed) {
      expect(q.object.value).not.toBe("https://framed-victim.example/id#it");
      expect(q.subject.value).not.toBe("https://victim.example/act");
    }
  });

  it("neutralises a hostile IRI in the plan/policy — no triple injection", async () => {
    const hostilePlan =
      "https://agent-a.example/policies/p> <https://evil/s> <https://evil/p> <https://evil/o";
    const quads = actionProvenance({
      activity: ACTIVITY,
      agent: AGENT,
      used: [RESOURCE],
      plan: hostilePlan,
      started: STARTED,
    });
    const ttl = await serialize(quads);
    expect(ttl).toContain("%3E");
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const reparsed = await parseRdf(ttl, "text/turtle");
    expect(reparsed.size).toBe(quads.length);
    for (const q of reparsed) {
      expect(q.object.value).not.toBe("https://evil/o");
      expect(q.subject.value).not.toBe("https://evil/s");
    }
  });
});

describe("actionProvenanceJsonLd — RDF+JSON-LD escaping parity", () => {
  it("round-trips via JSON-LD to the same triple shape as the RDF path", async () => {
    const input = fullInput();
    const doc = actionProvenanceJsonLd(input);
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const dataset = await parseRdf(JSON.stringify(doc), "application/ld+json");
    const jsonldTriples = [...dataset].map(
      (q) => `${q.subject.value} ${q.predicate.value} ${q.object.value}`,
    );

    expect(jsonldTriples).toContain(`${ACTIVITY} ${RDF_TYPE} ${PROV_ACTIVITY}`);
    expect(jsonldTriples).toContain(`${ACTIVITY} ${PROV_WAS_ASSOCIATED_WITH} ${AGENT}`);
    expect(jsonldTriples).toContain(`${ACTIVITY} ${PROV_USED} ${RESOURCE}`);
    expect(jsonldTriples).toContain(`${ACTIVITY} ${PROV_GENERATED} ${ARTIFACT}`);
    expect(jsonldTriples).toContain(`${AGENT} ${PROV_ACTED_ON_BEHALF_OF} ${PRINCIPAL}`);
    expect(jsonldTriples).toContain(`${ARTIFACT} ${PROV_WAS_DERIVED_FROM} ${RESOURCE}`);
    expect(jsonldTriples).toContain(`${ARTIFACT} ${PROV_WAS_GENERATED_BY} ${ACTIVITY}`);

    // Same triple COUNT as the RDF path (the reified association contributes
    // the same 3 triples via a blank node on both paths).
    const rdfQuads = actionProvenance(input);
    expect(dataset.size).toBe(rdfQuads.length);
  });

  it("escapes a hostile agent IRI IDENTICALLY in the JSON-LD @id and the RDF-path object IRI (delegatedUnder-style parity)", async () => {
    // Mirrors the delegationProvenance JSON-LD parity fix (05849c6): a
    // hostile IRI must be escaped the SAME WAY on both serialisations, or a
    // JSON-LD round-trip could carry a different string than the Turtle
    // round-trip and silently break identity comparisons downstream (e.g. an
    // auditor comparing the JSON-LD-sourced agent id against the
    // Turtle-sourced one). Uses the same no-fragment hostile-payload shape as
    // the delegatedUnder JSON-LD parity test (a `#`-bearing payload trips a
    // stricter IRI well-formedness check in the JSON-LD-to-RDF conversion
    // than Turtle's IRIREF grammar requires, which is an orthogonal — and
    // fail-CLOSED, since the triple is dropped rather than injected —
    // difference between the two libraries, not an escaping gap).
    const hostileAgent =
      "https://evil.example/x> <https://victim.example/act> <https://prov.example/wasAssociatedWith> <https://framed-victim.example/it> .\n<https://evil.example/x";
    const input: ActionProvenanceInput = {
      activity: ACTIVITY,
      agent: hostileAgent,
      used: [RESOURCE],
      plan: PLAN,
      started: STARTED,
    };

    const escaped = escapeIri(hostileAgent);
    expect(escaped).toContain("%3E");

    // RDF path.
    const rdfQuads = actionProvenance(input);
    const assocWith = rdfQuads.find((q) => q.predicate.value === PROV_WAS_ASSOCIATED_WITH);
    expect(assocWith?.object.value).toBe(escaped);

    // JSON-LD path — the @id is escaped identically, and no raw breakout
    // octet survives in the serialised JSON string.
    const doc = actionProvenanceJsonLd(input);
    const activityNode = doc["@graph"] as Record<string, unknown>[];
    const activity = activityNode.find((n) => n["@id"] === ACTIVITY);
    expect((activity?.wasAssociatedWith as { "@id": string })["@id"]).toBe(escaped);
    const json = JSON.stringify(doc);
    expect(json).not.toContain("act> <https://prov.example/wasAssociatedWith");

    // Re-parsing the JSON-LD document produces the SAME escaped agent value
    // as the RDF path — no injected triples, no divergent escaping.
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const dataset = await parseRdf(json, "application/ld+json");
    let found = false;
    for (const q of dataset) {
      if (q.predicate.value === PROV_WAS_ASSOCIATED_WITH) {
        expect(q.object.value).toBe(escaped);
        found = true;
      }
      expect(q.object.value).not.toBe("https://framed-victim.example/it");
      expect(q.subject.value).not.toBe("https://victim.example/act");
    }
    expect(found).toBe(true);
  });

  it("omits onBehalfOf / endedAtTime / generated fields when not supplied", () => {
    const doc = actionProvenanceJsonLd({
      activity: ACTIVITY,
      agent: AGENT,
      used: [RESOURCE],
      plan: PLAN,
      started: STARTED,
    });
    const graph = doc["@graph"] as Record<string, unknown>[];
    const activity = graph.find((n) => n["@id"] === ACTIVITY);
    expect(activity?.generated).toBeUndefined();
    expect(activity?.endedAtTime).toBeUndefined();
    expect(graph.some((n) => "actedOnBehalfOf" in n)).toBe(false);
  });
});
