// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import {
  buildProtocolDocument,
  buildResponseShape,
  buildShapeForIntent,
  canonicalNQuads,
  handshakeFromRdf,
  handshakeToRdf,
  handshakeToTurtle,
  hashQuads,
  intentToJsonLd,
  intentToRdf,
  intentToTurtle,
  parseIntentGraph,
  validateIntent,
  verifyProtocolDocument,
} from "../src/index.js";
import type { Intent, UpgradeOffer, UpgradeResponse } from "../src/types.js";
import { A2A, INTENT_ACTIONS, LEGACY_A2A_NS } from "../src/vocab.js";
import { wrapIntent } from "../src/wrappers.js";

const LEGACY = LEGACY_A2A_NS;
const expected: Intent = {
  id: "urn:intent",
  action: "grant",
  target: "https://pod.example/data",
  recipient: "https://bob.example/#me",
  modes: ["Read"],
  parameters: [{ key: "reason", value: "review" }],
};

function grantGraph(predicates: string, classes = predicates, values = predicates): string {
  return `@prefix p: <${predicates}> . @prefix c: <${classes}> .
    @prefix v: <${values}> . @prefix schema: <https://schema.org/> .
    <urn:intent> a c:Intent ; p:action <urn:action> ; p:parameter <urn:parameter> .
    <urn:action> a c:GrantAction ; schema:object <https://pod.example/data> ;
      schema:recipient <https://bob.example/#me> ;
      v:mode <http://www.w3.org/ns/auth/acl#Read> .
    <urn:parameter> a c:Parameter ; p:paramKey "reason" ; v:paramValue "review" .`;
}

function grantShape(predicates: string, classes = predicates): string {
  return `@prefix p: <${predicates}> . @prefix c: <${classes}> .
    @prefix sh: <http://www.w3.org/ns/shacl#> .
    @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
    <urn:shape> a sh:NodeShape ; sh:targetClass c:Intent ;
      sh:property [ sh:path p:action ; sh:minCount 1 ; sh:maxCount 1 ;
        sh:node [ sh:property [ sh:path rdf:type ; sh:hasValue c:GrantAction ] ;
          sh:property [ sh:path p:mode ; sh:minCount 1 ; sh:nodeKind sh:IRI ] ] ] .`;
}

describe("A2A namespace compatibility", () => {
  it.each([
    [LEGACY, LEGACY, LEGACY],
    [A2A, A2A, A2A],
    [LEGACY, A2A, A2A],
    [A2A, LEGACY, LEGACY],
  ])("reads predicates %s, classes %s and values %s", async (predicates, classes, values) => {
    expect(await parseIntentGraph(grantGraph(predicates, classes, values))).toEqual(expected);
  });

  it("reads legacy inline JSON-LD without dereferencing a context", async () => {
    const graph = {
      "@context": {
        a2a: LEGACY,
        schema: "https://schema.org/",
      },
      "@id": "urn:legacy-json",
      "@type": "a2a:Intent",
      "a2a:action": {
        "@type": "a2a:ListAction",
        "schema:target": { "@id": "https://pod.example/" },
      },
    };
    expect(await parseIntentGraph(JSON.stringify(graph), "application/ld+json")).toEqual({
      id: "urn:legacy-json",
      action: "list",
      target: "https://pod.example/",
    });
  });

  it("deduplicates mixed class, action, parameter and mode aliases", async () => {
    const dataset = await parseRdf(
      `${grantGraph(LEGACY)}
      <urn:intent> a <${A2A}Intent> ; <${A2A}action> <urn:action> ;
        <${A2A}parameter> <urn:parameter> .
      <urn:action> <${A2A}mode> <http://www.w3.org/ns/auth/acl#Read> .
      <urn:parameter> <${A2A}paramKey> "reason" ; <${A2A}paramValue> "review" .`,
      "text/turtle",
      {},
    );
    expect(wrapIntent(dataset).intents()).toHaveLength(1);
    expect(await parseIntentGraph(dataset)).toEqual(expected);
    expect((await validateIntent(dataset, buildShapeForIntent("grant"))).conforms).toBe(true);
  });

  it.each(INTENT_ACTIONS)("writes legacy wire RDF and inline JSON-LD for %s", async (action) => {
    const intent = { ...expected, action };
    const rdf = intentToRdf(intent);
    expect(await canonicalNQuads(rdf)).toContain(LEGACY);
    expect(await canonicalNQuads(rdf)).not.toContain(A2A);
    expect(JSON.stringify(intentToJsonLd(intent))).not.toContain(A2A);
    expect(await parseIntentGraph(await intentToTurtle(intent))).toEqual(intent);
  });

  it.each([
    [LEGACY, LEGACY],
    [A2A, A2A],
    [LEGACY, A2A],
    [A2A, LEGACY],
  ])("validates %s data with a %s shape without changing either graph", async (dataNs, shapeNs) => {
    const data = await parseRdf(grantGraph(dataNs), "text/turtle", {});
    const shape = await parseRdf(grantShape(shapeNs), "text/turtle", {});
    const before = await canonicalNQuads([...data]);
    const shapeHash = await hashQuads([...shape]);
    expect((await validateIntent(data, shape)).conforms).toBe(true);
    expect(await canonicalNQuads([...data])).toBe(before);
    expect(await hashQuads([...shape])).toBe(shapeHash);
    expect(await verifyProtocolDocument(shape, shapeHash)).toBe(true);
  });

  it("validates mixed shapes and rejects missing fields and distinct action aliases", async () => {
    const shape = await parseRdf(grantShape(LEGACY, A2A), "text/turtle", {});
    const good = await parseRdf(grantGraph(A2A, LEGACY), "text/turtle", {});
    expect((await validateIntent(good, shape)).conforms).toBe(true);
    const bad = await parseRdf(
      `
      <urn:intent> a <${LEGACY}Intent> ; <${A2A}action> <urn:a> ; <${LEGACY}action> <urn:b> .
      <urn:a> a <${A2A}GrantAction> . <urn:b> a <${LEGACY}GrantAction> .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(bad, buildShapeForIntent("grant"))).conforms).toBe(false);
    const missing = await parseRdf(`<urn:intent> a <${LEGACY}Intent> .`, "text/turtle", {});
    expect((await validateIntent(missing, buildShapeForIntent("grant"))).conforms).toBe(false);
  });

  it.each([
    [A2A, LEGACY],
    [LEGACY, A2A],
  ])("does not merge split grant fields on %s and %s action nodes", async (linkedNs, otherNs) => {
    const dataset = await parseRdf(
      `@prefix a2a: <${A2A}> . @prefix schema: <https://schema.org/> .
      <urn:intent> a a2a:Intent ; a2a:action <${linkedNs}x> .
      <${linkedNs}x> a a2a:GrantAction ; schema:object <https://pod.example/data> .
      <${otherNs}x> schema:recipient <https://bob.example/#me> ;
        <${LEGACY}mode> <http://www.w3.org/ns/auth/acl#Read> .`,
      "text/turtle",
      {},
    );
    const shape = buildShapeForIntent("grant");
    const report = await validateIntent(dataset, shape);
    expect(report.conforms).toBe(false);
    expect(report.results.length).toBeGreaterThan(0);
    expect(await parseIntentGraph(dataset)).toBeUndefined();
  });

  it("parses the same uniformly canonicalized identities and resources that SHACL validates", async () => {
    const dataset = await parseRdf(
      `@prefix old: <${LEGACY}> . @prefix a2a: <${A2A}> .
      @prefix schema: <https://schema.org/> .
      old:request a old:Intent ; a2a:action old:x ; old:parameter old:p .
      old:x a a2a:GrantAction ; schema:object old:resource ; schema:recipient old:recipient ;
        old:mode <http://www.w3.org/ns/auth/acl#Read> .
      old:p old:paramKey "reason" ; a2a:paramValue "review" .`,
      "text/turtle",
      {},
    );
    const parsed = await parseIntentGraph(dataset);
    expect(parsed).toEqual({
      ...expected,
      id: `${A2A}request`,
      target: `${A2A}resource`,
      recipient: `${A2A}recipient`,
    });
    const shape = await parseRdf(
      `${grantShape(LEGACY)}
      <urn:shape> <http://www.w3.org/ns/shacl#property> [
        <http://www.w3.org/ns/shacl#path> <${A2A}action> ;
        <http://www.w3.org/ns/shacl#hasValue> <${LEGACY}x> ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(dataset, shape)).conforms).toBe(true);
    expect((await validateIntent(parsed as Intent, buildShapeForIntent("grant"))).conforms).toBe(
      true,
    );
  });

  it("renames resource values consistently in the data and shape", async () => {
    const dataset = await parseRdf(
      `${grantGraph(A2A)}
      <urn:action> <https://schema.org/agent> <${LEGACY}agent> .`,
      "text/turtle",
      {},
    );
    const shape = await parseRdf(
      `${grantShape(A2A)}
      <urn:agent-shape> a <http://www.w3.org/ns/shacl#NodeShape> ;
        <http://www.w3.org/ns/shacl#targetNode> <urn:action> ;
        <http://www.w3.org/ns/shacl#property> [
          <http://www.w3.org/ns/shacl#path> <https://schema.org/agent> ;
          <http://www.w3.org/ns/shacl#hasValue> <${A2A}agent> ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(dataset, shape)).conforms).toBe(true);
    expect((await parseIntentGraph(dataset))?.agent).toBe(`${A2A}agent`);
  });

  it("counts distinct canonical and legacy action references separately", async () => {
    const dataset = await parseRdf(
      `@prefix a2a: <${A2A}> . @prefix old: <${LEGACY}> .
      @prefix schema: <https://schema.org/> .
      <urn:intent> a old:Intent ; a2a:action a2a:x ; old:action old:x .
      a2a:x a a2a:GrantAction ; schema:object <https://pod.example/data> ;
        schema:recipient <https://bob.example/#me> ; a2a:mode <http://www.w3.org/ns/auth/acl#Read> .
      old:x a old:GrantAction ; schema:object <https://pod.example/data> ;
        schema:recipient <https://bob.example/#me> ; old:mode <http://www.w3.org/ns/auth/acl#Read> .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(dataset, buildShapeForIntent("grant"))).conforms).toBe(false);
  });

  it("fails closed when targetNode identities would collapse", async () => {
    const data = await parseRdf(
      `<${LEGACY}x> <https://schema.org/name> "legacy" .
      <${A2A}x> <https://schema.org/name> "canonical" .`,
      "text/turtle",
      {},
    );
    const shape = await parseRdf(
      `@prefix sh: <http://www.w3.org/ns/shacl#> .
      <urn:shape> a sh:NodeShape ; sh:targetNode <${LEGACY}x> ;
        sh:property [ sh:path <https://schema.org/name> ; sh:hasValue "canonical" ] .`,
      "text/turtle",
      {},
    );
    const report = await validateIntent(data, shape);
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toContain("distinct data nodes");
    expect(await parseIntentGraph(data)).toBeUndefined();
  });

  it("writes legacy shapes and protocol metadata, preserving supplied shape bytes", async () => {
    const shape = buildShapeForIntent("grant");
    const response = buildResponseShape(`${LEGACY}Intent`);
    expect(await canonicalNQuads([...shape, ...response])).not.toContain(A2A);
    const pd = await buildProtocolDocument({ requestShape: shape, meta: { id: "urn:pd" } });
    expect(await pd.toTurtle()).not.toContain(A2A);
    expect(JSON.stringify(await pd.toJsonLd())).not.toContain(A2A);
    expect(await verifyProtocolDocument(await pd.toTurtle(), pd.hash)).toBe(true);

    const legacyShape = [...(await parseRdf(grantShape(LEGACY), "text/turtle", {}))];
    const legacyHash = await hashQuads(legacyShape);
    const compatible = await buildProtocolDocument({
      requestShape: legacyShape,
      meta: { id: "urn:pd" },
    });
    expect((await validateIntent(expected, compatible)).conforms).toBe(true);
    expect(await hashQuads(compatible.requestShapeQuads)).toBe(legacyHash);
    expect(await verifyProtocolDocument(await compatible.toTurtle(), compatible.hash)).toBe(true);
  });

  it("keeps legacy and canonical graph hashes distinct", async () => {
    const oldGraph = [...(await parseRdf(grantGraph(LEGACY), "text/turtle", {}))];
    const newGraph = [...(await parseRdf(grantGraph(A2A), "text/turtle", {}))];
    const oldHash = await hashQuads(oldGraph);
    expect(await verifyProtocolDocument(oldGraph, oldHash)).toBe(true);
    expect(await verifyProtocolDocument(newGraph, oldHash)).toBe(false);
  });
});

describe("handshake namespace compatibility", () => {
  const offer: UpgradeOffer = {
    kind: "upgrade-offer",
    protocolHash: "sha256:pinned",
    required: true,
    protocolSource: "https://w3id.org/jeswr/a2a-rdf/v1/spec",
    protocolName: "Grant",
  };
  const response: UpgradeResponse = {
    kind: "upgrade-response",
    protocolHash: "sha256:pinned",
    accept: true,
    reason: "agreed",
  };

  it.each([
    offer,
    response,
  ])("writes legacy %s wire terms and preserves protocol identifiers", async (message) => {
    const quads = handshakeToRdf(message);
    expect(await canonicalNQuads(quads)).not.toContain(A2A);
    expect(await handshakeFromRdf(await handshakeToTurtle(message))).toEqual(message);
  });

  it.each([LEGACY, A2A])("reads an offer with %s classes and mixed predicates", async (ns) => {
    const graph = `
      <urn:offer> a <${ns}UpgradeOffer>, <${A2A}UpgradeOffer> ;
        <${LEGACY}protocolHash> "sha256:pinned" ; <${A2A}protocolHash> "sha256:pinned" ;
        <${LEGACY}protocolSource> <https://w3id.org/jeswr/a2a-rdf/v1/spec> ;
        <${A2A}required> true ; <${LEGACY}required> true ; <${A2A}protocolName> "Grant" .`;
    expect(await handshakeFromRdf(graph)).toEqual(offer);
  });

  it("reads a legacy response and preserves its wire vocabulary", async () => {
    const old = `<urn:response> a <${LEGACY}UpgradeResponse> ;
      <${LEGACY}protocolHash> "sha256:pinned" ; <${LEGACY}accept> true ; <${LEGACY}reason> "agreed" .`;
    const back = await handshakeFromRdf(old);
    expect(back).toEqual(response);
    expect(await handshakeToTurtle(back as UpgradeResponse)).not.toContain(A2A);
  });

  it("rejects conflicting security flags across namespace aliases", async () => {
    const old = `<urn:offer> a <${LEGACY}UpgradeOffer> ;
      <${LEGACY}protocolHash> "sha256:pinned" ;
      <${LEGACY}protocolSource> <https://pod.example/protocol> ;
      <${LEGACY}required> true ; <${A2A}required> false .`;
    expect(await handshakeFromRdf(old)).toBeUndefined();
    const response = `<urn:response> a <${A2A}UpgradeResponse> ;
      <${A2A}protocolHash> "sha256:pinned" ; <${LEGACY}accept> true ; <${A2A}accept> false .`;
    expect(await handshakeFromRdf(response)).toBeUndefined();
  });

  it("rejects both handshake classes even when they use different namespace aliases", async () => {
    expect(
      await handshakeFromRdf(`<urn:message> a <${LEGACY}UpgradeOffer>, <${A2A}UpgradeResponse> .`),
    ).toBeUndefined();
  });
});
