// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Golden-master / characterization tests pinning the OBSERVABLE OUTPUTS of the
// public API before any refactor: the emitted A2A Agent Card (JSON), the ANP
// Agent Description (canonicalised N-Triples — sorted, blank nodes relabelled by
// a STRUCTURAL signature, literals carrying datatype/language — plus JSON-LD),
// the person→agent pointer triples, and the verify/discover outcomes. These are
// the behaviour fences a structural refactor must NOT move: every emitted RDF
// IRI/predicate/literal (datatype included) and verify outcome is bound here, so
// a snapshot drift is stop-the-line. Canonicalisation makes the RDF snapshots
// invariant to the two NON-contractual sources of variation — quad order and
// blank-node naming — while still catching any real graph change.

import type { Quad, Term } from "@rdfjs/types";
import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import { describeAgent } from "../src/describe.js";
import { agentCardUrl, agentDescriptionsUrl } from "../src/discover.js";
import { buildAgentPointer } from "../src/pointer.js";
import type { AgentDescriptor } from "../src/types.js";
import { verifyDescriptor } from "../src/verify.js";

/**
 * Serialise a NON-blank term to a fully-qualified N-Triples lexical form that
 * preserves EVERY contractual facet — for a literal that means its lexical value
 * AND its datatype/language tag (a regression from a plain string to a
 * language-tagged or differently-typed literal with the same value must be
 * caught). Blank nodes are handled by {@link canonicalize}, not here.
 */
function groundTerm(t: Term): string {
  if (t.termType === "Literal") {
    const lit = t as Term & { language: string; datatype: { value: string } };
    if (lit.language) return `${JSON.stringify(t.value)}@${lit.language}`;
    return `${JSON.stringify(t.value)}^^<${lit.datatype.value}>`;
  }
  return `<${t.value}>`;
}

/**
 * Canonicalise a Turtle string to sorted N-Triples with blank nodes relabelled
 * by a STRUCTURAL signature (a hash of their own outgoing triples), not by the
 * parser-assigned id. This makes the snapshot invariant to both non-contractual
 * sources of variation — quad ORDER and blank-node NAMING — so a serialiser
 * change that only renames/reorders blank nodes produces NO churn while any real
 * graph change (an IRI, predicate, literal, datatype or language tag) still does.
 *
 * The agent-description graph this package emits is a star: a single named
 * subject linking to LEAF blank nodes (skills / security schemes) that carry
 * only ground triples and never reference one another. For such ground+leaf-blank
 * graphs a label derived from a blank node's own outgoing ground triples is a
 * sound canonical labelling (no inter-blank cycles to disambiguate), so a full
 * URDNA2015 dependency would be strictly more audit surface than the test needs.
 */
function canonicalize(turtle: string): string {
  const quads = new Parser().parse(turtle) as Quad[];

  // 1. For each blank node, collect its own outgoing (predicate, object) ground
  //    triples and build a stable signature from them.
  const sigParts = new Map<string, string[]>();
  for (const q of quads) {
    if (q.subject.termType !== "BlankNode") continue;
    if (q.object.termType === "BlankNode") {
      throw new Error("canonicalize: nested blank nodes are out of this graph's contract.");
    }
    const parts = sigParts.get(q.subject.value) ?? [];
    parts.push(`<${q.predicate.value}> ${groundTerm(q.object)}`);
    sigParts.set(q.subject.value, parts);
  }
  const label = new Map<string, string>();
  for (const [bn, parts] of sigParts) {
    label.set(bn, `_:[${[...parts].sort().join(" | ")}]`);
  }

  // 2. Emit one canonical line per quad with blanks replaced by their structural
  //    label, then sort. Two structurally-identical blank nodes would collide on
  //    label; this graph never emits two identical leaf nodes, so it is injective.
  const term = (t: Term): string =>
    t.termType === "BlankNode" ? (label.get(t.value) ?? "_:?") : groundTerm(t);
  return quads
    .map((q) => `${term(q.subject)} <${q.predicate.value}> ${term(q.object)}`)
    .sort()
    .join("\n");
}

const FULL: AgentDescriptor = {
  id: "https://alice.pod.example/agent",
  name: "Alice's Agent",
  description: "Represents Alice.",
  owner: "https://alice.pod.example/profile/card#me",
  did: "did:web:alice.pod.example",
  url: "https://alice.pod.example/agent/endpoint",
  skills: [
    {
      id: "schedule",
      name: "Scheduling",
      description: "Negotiate meetings",
      tags: ["calendar", "time"],
    },
    { id: "contacts", name: "Contacts" },
  ],
  securitySchemes: [
    { type: "solid-oidc", issuer: "https://idp.example/", description: "Solid-OIDC + DPoP" },
    { type: "public" },
  ],
  protocolSources: ["https://alice.pod.example/protocols/exchange#v1"],
};

const MINIMAL: AgentDescriptor = { id: "https://a/agent", name: "A" };

describe("characterization — A2A Agent Card (full)", () => {
  it("emits the exact card object", () => {
    expect(describeAgent(FULL).agentCard).toMatchSnapshot();
  });
  it("emits the exact card object (minimal)", () => {
    expect(describeAgent(MINIMAL).agentCard).toMatchSnapshot();
  });
});

describe("characterization — ANP Agent Description RDF (canonical N-Quads)", () => {
  it("pins the full descriptor graph", async () => {
    const ttl = await describeAgent(FULL).agentDescription.toTurtle();
    expect(canonicalize(ttl)).toMatchSnapshot();
  });
  it("pins the minimal descriptor graph", async () => {
    const ttl = await describeAgent(MINIMAL).agentDescription.toTurtle();
    expect(canonicalize(ttl)).toMatchSnapshot();
  });
  it("pins the JSON-LD projection (full)", async () => {
    expect(await describeAgent(FULL).agentDescription.toJsonLd()).toMatchSnapshot();
  });
  it("pins the JSON-LD projection (minimal)", async () => {
    expect(await describeAgent(MINIMAL).agentDescription.toJsonLd()).toMatchSnapshot();
  });
});

describe("characterization — person→agent pointer triples", () => {
  it("pins the default (interop) pointer graph", async () => {
    const ttl = await buildAgentPointer(
      "https://alice.pod.example/profile/card#me",
      "https://alice.pod.example/agent",
    ).toString();
    expect(canonicalize(ttl)).toMatchSnapshot();
  });
  it("pins both-predicate pointer graph", async () => {
    const ttl = await buildAgentPointer(
      "https://alice.pod.example/profile/card#me",
      "https://alice.pod.example/agent",
      ["interop:hasAuthorizationAgent", "schema:agent"],
    ).toString();
    expect(canonicalize(ttl)).toMatchSnapshot();
  });
});

describe("characterization — well-known URLs", () => {
  it("pins the ANP + A2A discovery URLs", () => {
    expect({
      anp: agentDescriptionsUrl("https://alice.pod.example/agent/endpoint?x=1#frag"),
      a2a: agentCardUrl("https://alice.pod.example/agent/endpoint?x=1#frag"),
    }).toMatchSnapshot();
  });
});

describe("characterization — verify round-trip (emit → verify)", () => {
  it("round-trips the emitted Turtle back to a valid descriptor", async () => {
    const ttl = await describeAgent(FULL).agentDescription.toTurtle();
    const result = await verifyDescriptor("https://alice.pod.example/agent", {
      body: ttl,
      bodyContentType: "text/turtle",
      expectedId: "https://alice.pod.example/agent",
    });
    expect({
      valid: result.valid,
      issues: result.issues,
      descriptor: result.descriptor,
    }).toMatchSnapshot();
  });

  it("pins the issue set for a malformed descriptor", async () => {
    // Missing name + url, a non-IRI owner, a duplicate skill id, an unknown scheme.
    const bad = [
      "@prefix ad: <https://w3id.org/agent-description#> .",
      "<https://x/agent> a ad:AgentDescription ;",
      '  ad:owner "not-an-iri" ;',
      '  ad:skill [ a ad:Skill ; ad:skillId "s" ; ad:name "S" ] ;',
      '  ad:skill [ a ad:Skill ; ad:skillId "s" ; ad:name "S2" ] ;',
      '  ad:securityScheme [ a ad:SecurityScheme ; ad:schemeType "nope" ] .',
    ].join("\n");
    const result = await verifyDescriptor("https://x/agent", {
      body: bad,
      bodyContentType: "text/turtle",
      expectedId: "https://x/agent",
    });
    const codes = result.issues.map((i) => i.code).sort();
    expect({ valid: result.valid, codes }).toMatchSnapshot();
  });
});
