// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Protocol Document: build → hash is stable/deterministic across runs;
// verifyProtocolDocument accepts the matching hash + rejects a tampered body;
// toTurtle / toJsonLd round-trip the shape.
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import { parseIntentGraph } from "../src/intent.js";
import { buildProtocolDocument, hashQuads, verifyProtocolDocument } from "../src/protocol.js";
import { buildResponseShape, buildShapeForIntent } from "../src/shape.js";
import { PROTOCOL_HASH_PREFIX } from "../src/vocab.js";

function makePd(id = "https://alice.pod/protocols/read#v1") {
  return buildProtocolDocument({
    requestShape: buildShapeForIntent("read"),
    responseShape: buildResponseShape("https://schema.org/ReadAction"),
    meta: { id, name: "Read protocol", description: "Read a pod resource.", version: "1" },
  });
}

describe("buildProtocolDocument", () => {
  it("requires a meta.id and a non-empty requestShape", async () => {
    await expect(
      buildProtocolDocument({ requestShape: buildShapeForIntent("read"), meta: { id: "" } }),
    ).rejects.toThrow(TypeError);
    await expect(
      buildProtocolDocument({ requestShape: [], meta: { id: "https://a/p" } }),
    ).rejects.toThrow(TypeError);
  });

  it("produces a sha256: hash over the canonical graph", async () => {
    const pd = await makePd();
    expect(pd.hash.startsWith(PROTOCOL_HASH_PREFIX)).toBe(true);
    // sha256 hex is 64 chars after the prefix.
    expect(pd.hash.slice(PROTOCOL_HASH_PREFIX.length)).toHaveLength(64);
  });

  it("hash is DETERMINISTIC across two independent builds of the same logical PD", async () => {
    expect((await makePd()).hash).toBe((await makePd()).hash);
  });

  it("hash CHANGES when the protocol content changes (version / shape)", async () => {
    const a = await makePd();
    const b = await buildProtocolDocument({
      requestShape: buildShapeForIntent("read"),
      responseShape: buildResponseShape("https://schema.org/ReadAction"),
      meta: { id: "https://alice.pod/protocols/read#v1", name: "Read protocol", version: "2" },
    });
    expect(a.hash).not.toBe(b.hash);
    // A different action shape also changes the hash.
    const c = await buildProtocolDocument({
      requestShape: buildShapeForIntent("delete"),
      meta: { id: "https://alice.pod/protocols/read#v1", name: "Read protocol", version: "1" },
    });
    expect(a.hash).not.toBe(c.hash);
  });

  it("links the PD to its request/response shape subjects", async () => {
    const pd = await makePd();
    const ttl = await pd.toTurtle();
    expect(ttl).toContain("a2a:requestShape");
    expect(ttl).toContain("a2a:responseShape");
    expect(ttl).toContain("a2a:ProtocolDocument");
  });
});

describe("verifyProtocolDocument", () => {
  it("accepts a body that matches the pinned hash (Turtle round-trip)", async () => {
    const pd = await makePd();
    const ttl = await pd.toTurtle();
    expect(await verifyProtocolDocument(ttl, pd.hash)).toBe(true);
  });

  it("accepts the quads / dataset forms too", async () => {
    const pd = await makePd();
    expect(await verifyProtocolDocument(pd.quads, pd.hash)).toBe(true);
  });

  it("REJECTS a tampered body (extra triple) for the original hash", async () => {
    const pd = await makePd();
    const tampered = `${await pd.toTurtle()}\n<https://evil/x> <https://evil/p> <https://evil/o> .`;
    expect(await verifyProtocolDocument(tampered, pd.hash)).toBe(false);
  });

  it("REJECTS a wrong / truncated expected hash", async () => {
    const pd = await makePd();
    const ttl = await pd.toTurtle();
    expect(await verifyProtocolDocument(ttl, "sha256:deadbeef")).toBe(false);
    expect(await verifyProtocolDocument(ttl, `${pd.hash}00`)).toBe(false);
  });

  it("fails closed (returns false, no throw) on an unparseable body", async () => {
    expect(await verifyProtocolDocument("<<<not rdf>>>", "sha256:abc", "text/turtle")).toBe(false);
  });
});

describe("Protocol Document serialisation", () => {
  it("toTurtle is re-parseable and re-hashes to the same value (hash stability over round-trip)", async () => {
    const pd = await makePd();
    const ttl = await pd.toTurtle();
    // Re-parse via the verify path: a parsed-then-rehashed body matches.
    expect(await verifyProtocolDocument(ttl, pd.hash)).toBe(true);
  });

  it("toJsonLd carries the metadata + shape links with the inline @context", async () => {
    const pd = await makePd();
    const jsonld = await pd.toJsonLd();
    expect(jsonld["@type"]).toBe("ProtocolDocument");
    expect(jsonld["@id"]).toBe("https://alice.pod/protocols/read#v1");
    expect(jsonld.title).toBe("Read protocol");
    expect(jsonld.version).toBe("1");
    expect((jsonld as Record<string, unknown>)["@context"]).toBeTypeOf("object");
    expect(Array.isArray(jsonld.requestShape)).toBe(true);
  });

  it("maps description to dcterms:description in the JSON-LD @context (no silent loss)", async () => {
    const pd = await makePd();
    const jsonld = await pd.toJsonLd();
    expect(jsonld.description).toBe("Read a pod resource.");
    const ctx = (jsonld as Record<string, unknown>)["@context"] as Record<string, unknown>;
    expect(ctx.description).toBe("http://purl.org/dc/terms/description");
  });

  it("a PD built with no response shape omits the response link", async () => {
    const pd = await buildProtocolDocument({
      requestShape: buildShapeForIntent("read"),
      meta: { id: "https://a/p#v1", name: "Read" },
    });
    const ttl = await pd.toTurtle();
    expect(ttl).not.toContain("a2a:responseShape");
    const jsonld = await pd.toJsonLd();
    expect(jsonld.responseShape).toBeUndefined();
  });
});

describe("hashQuads", () => {
  it("is order-independent (same multiset of quads → same hash)", async () => {
    const pd = await makePd();
    const reversed = [...pd.quads].reverse();
    expect(await hashQuads(pd.quads)).toBe(await hashQuads(reversed));
  });

  it("an empty graph hashes to a stable value", async () => {
    expect(await hashQuads([])).toBe(await hashQuads([]));
    expect((await hashQuads([])).startsWith(PROTOCOL_HASH_PREFIX)).toBe(true);
  });

  it("the PD is discoverable via parseIntentGraph-style RDF tooling (it is valid RDF)", async () => {
    const pd = await makePd();
    const ttl = await pd.toTurtle();
    // parseIntentGraph parses any RDF; a PD has no a2a:Intent, so → undefined,
    // but it must PARSE (no throw) — proving the emitted Turtle is well-formed.
    await expect(parseIntentGraph(ttl)).resolves.toBeUndefined();
  });
});

// Cross-implementation conformance vector: the a2a-rdf extension specification
// (https://w3id.org/jeswr/a2a-rdf/v1, §"Content addressing") normatively requires
// the protocol hash to be `sha256:` over the RDFC-1.0 canonical N-Quads of the PD
// graph, and its worked example commits a concrete value. This proves THIS codec's
// hashQuads reproduces that committed value over the spec's published PD graph —
// i.e. we now agree with an independent RDFC-1.0 implementation (the spec's example
// hash was computed separately with rdf-canonize 5.0.0). A regression here means the
// canonicalization drifted off RDFC-1.0 and cross-implementation pinning is broken.
describe("RDFC-1.0 conformance — spec worked-example hash", () => {
  // The PD graph from the extension spec's "Data model" example (index.html
  // #pd-model), verbatim (HTML entities un-escaped). Self-contained: no external
  // shapes to dereference.
  const specExamplePdTurtle = `@prefix a2a: <https://w3id.org/jeswr/a2a#>.
@prefix schema: <https://schema.org/>.
@prefix sh: <http://www.w3.org/ns/shacl#>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix dcterms: <http://purl.org/dc/terms/>.

<https://alice.pod.example/protocols/grant-access> a a2a:ProtocolDocument;
    dcterms:title "Grant access";
    dcterms:hasVersion "1.0.0";
    a2a:requestShape a2a:GrantIntentShape.
a2a:GrantIntentShape a sh:NodeShape;
    sh:targetClass a2a:Intent;
    sh:property [ a sh:PropertyShape;
        sh:path a2a:action; sh:minCount 1; sh:maxCount 1; sh:name "action";
        sh:node [ a sh:NodeShape;
            sh:property
                [ a sh:PropertyShape; sh:path rdf:type; sh:minCount 1; sh:hasValue a2a:GrantAction ],
                [ a sh:PropertyShape; sh:path schema:object; sh:minCount 1; sh:name "target"; sh:nodeKind sh:IRI ],
                [ a sh:PropertyShape; sh:path schema:recipient; sh:minCount 1; sh:name "recipient"; sh:nodeKind sh:IRI ],
                [ a sh:PropertyShape; sh:path a2a:mode; sh:minCount 1; sh:name "mode"; sh:nodeKind sh:IRI ] ] ].`;

  // The value committed in the spec's worked example (index.html, params
  // .protocolDocuments[0].hash + the offer/response/part protocolHash).
  const specExampleHash = "sha256:4af1e70e42283872cbc0dd3a5eeaa1bd86adda728c993447bed8930d990ab509";

  it("hashQuads over the spec's example PD graph equals the spec's committed hash", async () => {
    const dataset = await parseRdf(specExamplePdTurtle, "text/turtle", {});
    const quads = [...dataset];
    expect(await hashQuads(quads)).toBe(specExampleHash);
  });

  it("verifyProtocolDocument accepts the spec's example body against its committed hash", async () => {
    expect(await verifyProtocolDocument(specExamplePdTurtle, specExampleHash)).toBe(true);
  });
});
