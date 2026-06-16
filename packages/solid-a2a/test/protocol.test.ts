// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Protocol Document: build → hash is stable/deterministic across runs;
// verifyProtocolDocument accepts the matching hash + rejects a tampered body;
// toTurtle / toJsonLd round-trip the shape.
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
  it("requires a meta.id and a non-empty requestShape", () => {
    expect(() =>
      buildProtocolDocument({ requestShape: buildShapeForIntent("read"), meta: { id: "" } }),
    ).toThrow(TypeError);
    expect(() => buildProtocolDocument({ requestShape: [], meta: { id: "https://a/p" } })).toThrow(
      TypeError,
    );
  });

  it("produces a sha256: hash over the canonical graph", () => {
    const pd = makePd();
    expect(pd.hash.startsWith(PROTOCOL_HASH_PREFIX)).toBe(true);
    // sha256 hex is 64 chars after the prefix.
    expect(pd.hash.slice(PROTOCOL_HASH_PREFIX.length)).toHaveLength(64);
  });

  it("hash is DETERMINISTIC across two independent builds of the same logical PD", () => {
    expect(makePd().hash).toBe(makePd().hash);
  });

  it("hash CHANGES when the protocol content changes (version / shape)", () => {
    const a = makePd();
    const b = buildProtocolDocument({
      requestShape: buildShapeForIntent("read"),
      responseShape: buildResponseShape("https://schema.org/ReadAction"),
      meta: { id: "https://alice.pod/protocols/read#v1", name: "Read protocol", version: "2" },
    });
    expect(a.hash).not.toBe(b.hash);
    // A different action shape also changes the hash.
    const c = buildProtocolDocument({
      requestShape: buildShapeForIntent("delete"),
      meta: { id: "https://alice.pod/protocols/read#v1", name: "Read protocol", version: "1" },
    });
    expect(a.hash).not.toBe(c.hash);
  });

  it("links the PD to its request/response shape subjects", async () => {
    const pd = makePd();
    const ttl = await pd.toTurtle();
    expect(ttl).toContain("a2a:requestShape");
    expect(ttl).toContain("a2a:responseShape");
    expect(ttl).toContain("a2a:ProtocolDocument");
  });
});

describe("verifyProtocolDocument", () => {
  it("accepts a body that matches the pinned hash (Turtle round-trip)", async () => {
    const pd = makePd();
    const ttl = await pd.toTurtle();
    expect(await verifyProtocolDocument(ttl, pd.hash)).toBe(true);
  });

  it("accepts the quads / dataset forms too", async () => {
    const pd = makePd();
    expect(await verifyProtocolDocument(pd.quads, pd.hash)).toBe(true);
  });

  it("REJECTS a tampered body (extra triple) for the original hash", async () => {
    const pd = makePd();
    const tampered = `${await pd.toTurtle()}\n<https://evil/x> <https://evil/p> <https://evil/o> .`;
    expect(await verifyProtocolDocument(tampered, pd.hash)).toBe(false);
  });

  it("REJECTS a wrong / truncated expected hash", async () => {
    const pd = makePd();
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
    const pd = makePd();
    const ttl = await pd.toTurtle();
    // Re-parse via the verify path: a parsed-then-rehashed body matches.
    expect(await verifyProtocolDocument(ttl, pd.hash)).toBe(true);
  });

  it("toJsonLd carries the metadata + shape links with the inline @context", async () => {
    const pd = makePd();
    const jsonld = await pd.toJsonLd();
    expect(jsonld["@type"]).toBe("ProtocolDocument");
    expect(jsonld["@id"]).toBe("https://alice.pod/protocols/read#v1");
    expect(jsonld.title).toBe("Read protocol");
    expect(jsonld.version).toBe("1");
    expect((jsonld as Record<string, unknown>)["@context"]).toBeTypeOf("object");
    expect(Array.isArray(jsonld.requestShape)).toBe(true);
  });

  it("maps description to dcterms:description in the JSON-LD @context (no silent loss)", async () => {
    const pd = makePd();
    const jsonld = await pd.toJsonLd();
    expect(jsonld.description).toBe("Read a pod resource.");
    const ctx = (jsonld as Record<string, unknown>)["@context"] as Record<string, unknown>;
    expect(ctx.description).toBe("http://purl.org/dc/terms/description");
  });

  it("a PD built with no response shape omits the response link", async () => {
    const pd = buildProtocolDocument({
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
    const pd = makePd();
    const reversed = [...pd.quads].reverse();
    expect(hashQuads(pd.quads)).toBe(hashQuads(reversed));
  });

  it("an empty graph hashes to a stable value", () => {
    expect(hashQuads([])).toBe(hashQuads([]));
    expect(hashQuads([]).startsWith(PROTOCOL_HASH_PREFIX)).toBe(true);
  });

  it("the PD is discoverable via parseIntentGraph-style RDF tooling (it is valid RDF)", async () => {
    const pd = makePd();
    const ttl = await pd.toTurtle();
    // parseIntentGraph parses any RDF; a PD has no a2a:Intent, so → undefined,
    // but it must PARSE (no throw) — proving the emitted Turtle is well-formed.
    await expect(parseIntentGraph(ttl)).resolves.toBeUndefined();
  });
});
