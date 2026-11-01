// AUTHORED-BY Claude Opus 5.5
//
// Hardening regressions (sst-8xm.9.23). Each case pins a defect the adversarial
// review reproduced: a graph that passes one request shape projecting to another
// action, ambiguous values picked by triple order, NL modes and recipients read
// from inside URLs, peer shapes that hang or throw, unchecked Intent objects, and
// handshake decoders that accept what the encoder refuses.

import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import {
  buildShapeForIntent,
  classifyDeterministic,
  decodeUpgradeOffer,
  handshakeFromRdf,
  type Intent,
  intentToJsonLd,
  intentToRdf,
  parseIntentGraph,
  validateIntent,
} from "../src/index.js";

const PREFIXES = `@prefix a2a: <https://w3id.org/jeswr/a2a#> .
@prefix schema: <https://schema.org/> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
`;

describe("the projection fails closed where the shapes leave room", () => {
  it("an action typed with two kinds conforms to one shape but projects to nothing", async () => {
    const body = `${PREFIXES}
<urn:i:1> a a2a:Intent ; a2a:action _:act .
_:act a schema:DeleteAction, a2a:ListAction ;
  schema:target <https://alice.example/public/> ;
  schema:object <https://alice.example/private/secret.ttl> .`;
    const report = await validateIntent(
      await parseRdf(body, "text/turtle"),
      buildShapeForIntent("list"),
    );
    expect(report.conforms).toBe(true);
    expect(await parseIntentGraph(body)).toBeUndefined();
  });

  it.each([
    [
      "two objects",
      "schema:object <https://alice.example/a> , <https://alice.example/b> ; schema:recipient <https://bob.example/#me>",
    ],
    [
      "two recipients",
      "schema:object <https://alice.example/a> ; schema:recipient <https://mallory.example/#me> , <https://bob.example/#me>",
    ],
    [
      "an unknown mode",
      "schema:object <https://alice.example/a> ; schema:recipient <https://bob.example/#me> ; a2a:mode <https://evil.example/AllModes>",
    ],
    [
      "an action agent that disagrees with the intent agent",
      "schema:object <https://alice.example/a> ; schema:recipient <https://bob.example/#me> ; schema:agent <https://mallory.example/#me>",
    ],
    [
      "a relative object IRI",
      "schema:object <../../.acl> ; schema:recipient <https://bob.example/#me>",
    ],
  ])("a grant with %s projects to nothing", async (_label, fields) => {
    const body = `${PREFIXES}
<urn:i:2> a a2a:Intent ; schema:agent <https://alice.example/#me> ; a2a:action _:a .
_:a a a2a:GrantAction ; ${fields} ; a2a:mode acl:Read .`;
    expect(await parseIntentGraph(body)).toBeUndefined();
  });

  it("an unambiguous grant still projects", async () => {
    const body = `${PREFIXES}
<urn:i:3> a a2a:Intent ; schema:agent <https://alice.example/#me> ; a2a:action _:a .
_:a a a2a:GrantAction ; schema:object <https://alice.example/a> ;
  schema:recipient <https://bob.example/#me> ; schema:agent <https://alice.example/#me> ;
  a2a:mode acl:Read , acl:Write .`;
    expect(await parseIntentGraph(body)).toMatchObject({
      action: "grant",
      target: "https://alice.example/a",
      recipient: "https://bob.example/#me",
      agent: "https://alice.example/#me",
    });
  });
});

describe("the deterministic NL parser reads only the prose", () => {
  it("does not take ACL modes from inside a URL", () => {
    expect(
      classifyDeterministic(
        "share https://alice.example/notes.ttl with https://bob.example/control#me",
      )?.modes,
    ).toBeUndefined();
    expect(
      classifyDeterministic(
        "share read access to https://alice.example/write-ups/notes.ttl with https://bob.example/#me",
      )?.modes,
    ).toEqual(["Read"]);
  });

  it("does not take a recipient marker from a URL's query string", () => {
    const draft = classifyDeterministic(
      "share read access to https://alice.example/doc?recipient=https://mallory.example/%23me with https://bob.example/#me",
    );
    expect(draft?.recipient).toBe("https://bob.example/#me");
  });
});

describe("validateIntent reports, never throws or hangs", () => {
  const intent: Intent = {
    id: "urn:i:5",
    action: "read",
    target: `https://alice.example/${"a".repeat(28)}!`,
  };
  const shape = (extra: string) =>
    parseRdf(
      `@prefix sh: <http://www.w3.org/ns/shacl#> . @prefix a2a: <https://w3id.org/jeswr/a2a#> .
<urn:S> a sh:NodeShape ; sh:targetClass a2a:Intent ; ${extra} .`,
      "text/turtle",
    );

  it("refuses a peer shape with a backtracking sh:pattern", async () => {
    const started = performance.now();
    const report = await validateIntent(
      intent,
      await shape(
        `sh:property [ sh:path a2a:action ; sh:node [ sh:property [ sh:path <https://schema.org/object> ; sh:pattern "^(([a-z:/.]+)+)+$" ] ] ]`,
      ),
    );
    expect(report.conforms).toBe(false);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("refuses a peer shape whose sh:and references double at each level", async () => {
    let levels = "";
    for (let i = 0; i < 40; i++)
      levels += `<urn:L${i}> sh:and ( <urn:L${i + 1}> <urn:L${i + 1}> ) .\n`;
    const started = performance.now();
    const report = await validateIntent(
      intent,
      await shape(`sh:and ( <urn:L0> <urn:L0> ) .\n${levels}<urn:L40> sh:nodeKind sh:IRI`),
    );
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toMatch(/evaluation budget/);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  for (const [name, extra] of [
    ["sh:or", "sh:or ( <urn:A> <urn:A> )"],
    ["sh:xone", "sh:xone ( <urn:A> <urn:A> )"],
    ["sh:node", "sh:node <urn:A>, <urn:A2>"],
    ["sh:not", "sh:not <urn:A>"],
  ] as const) {
    it(`counts ${name} references against the budget`, async () => {
      let levels = "";
      for (let i = 0; i < 30; i++) {
        levels += `<urn:A${i === 0 ? "" : i}> sh:or ( <urn:A${i + 1}> <urn:A${i + 1}> ) .\n`;
      }
      const report = await validateIntent(
        intent,
        await shape(`${extra} .\n${levels}<urn:A2> a sh:NodeShape`),
      );
      expect(report.conforms).toBe(false);
      expect(report.results[0]?.message).toMatch(/evaluation budget/);
    });
  }

  it("refuses shape reference cycles, looping lists and disjoint qualified shapes", async () => {
    for (const extra of [
      "sh:node <urn:S>",
      "sh:and _:l . _:l <http://www.w3.org/1999/02/22-rdf-syntax-ns#first> <urn:X> ; <http://www.w3.org/1999/02/22-rdf-syntax-ns#rest> _:l",
      "sh:or <urn:not-a-list>",
      "sh:property [ sh:path a2a:action ; sh:qualifiedValueShape [ sh:nodeKind sh:IRI ] ; sh:qualifiedMinCount 1 ; sh:qualifiedValueShapesDisjoint true ]",
    ]) {
      const report = await validateIntent(intent, await shape(extra));
      expect(report.conforms).toBe(false);
      expect(report.results[0]?.message).toMatch(/not evaluated \(unbounded cost\)/);
    }
  });

  it("still evaluates bounded nested shapes", async () => {
    const report = await validateIntent(
      intent,
      await shape(
        "sh:and ( [ sh:nodeKind sh:IRI ] [ sh:property [ sh:path a2a:action ; sh:minCount 1 ] ] ) ; sh:or ( [ sh:nodeKind sh:IRI ] )",
      ),
    );
    expect(report.conforms).toBe(true);
    for (const action of ["read", "grant", "list", "subscribe"] as const) {
      const built = await validateIntent(intent, buildShapeForIntent(action));
      expect(built.results.every((r) => !/unbounded cost/.test(r.message))).toBe(true);
    }
  });

  it("an invalid regex or an invalid Intent is a non-conformance", async () => {
    const bad = await validateIntent(
      intent,
      await shape(`sh:property [ sh:path a2a:action ; sh:pattern "(" ]`),
    );
    expect(bad.conforms).toBe(false);
    const wrongAction = await validateIntent(
      { ...intent, action: "constructor" } as unknown as Intent,
      buildShapeForIntent("read"),
    );
    expect(wrongAction.conforms).toBe(false);
  });
});

describe("a graph with several intents projects to none", () => {
  it("does not pick one of two conforming grants by store order", async () => {
    const body = `${PREFIXES}
<urn:i:benign> a a2a:Intent ; a2a:action _:a .
_:a a a2a:GrantAction ; schema:object <https://alice.example/pub> ;
  schema:recipient <https://bob.example/#me> ; a2a:mode acl:Read, acl:Read2 .
<urn:i:evil> a a2a:Intent ; a2a:action _:b .
_:b a a2a:GrantAction ; schema:object <https://alice.example/private/> ;
  schema:recipient <https://mallory.example/#me> ; a2a:mode acl:Control .`;
    expect(await parseIntentGraph(body)).toBeUndefined();
  });

  it("does not pick an agent when two intents share one action", async () => {
    const body = `${PREFIXES}
<urn:i:1> a a2a:Intent ; a2a:action <urn:act> ; schema:agent <https://a.example/#me> .
<urn:i:2> a a2a:Intent ; a2a:action <urn:act> ; schema:agent <https://b.example/#me> .
<urn:act> a schema:ReadAction ; schema:object <https://alice.example/x> .`;
    expect(await parseIntentGraph(body)).toBeUndefined();
  });
});

describe("Intent objects are checked before lowering", () => {
  for (const intent of [
    { id: "urn:i:6", action: "transfer" },
    { id: "urn:i:6", action: "constructor" },
    {
      id: "urn:i:6",
      action: "grant",
      target: "https://alice.example/a",
      recipient: "https://bob.example/#me",
      modes: ["toString"],
    },
    {
      id: "urn:i:6",
      action: "grant",
      target: "https://alice.example/a",
      recipient: "https://bob.example/#me",
      modes: ["__proto__"],
    },
  ]) {
    it(`RDF and JSON-LD both refuse ${JSON.stringify(intent.modes ?? intent.action)}`, () => {
      expect(() => intentToRdf(intent as unknown as Intent)).toThrow(/unknown/);
      expect(() => intentToJsonLd(intent as unknown as Intent)).toThrow(/unknown/);
    });
  }
});

describe("handshake decoders accept only what the encoder emits", () => {
  it("a JSON offer must name an http(s) protocol source", () => {
    for (const protocolSource of ["file:///etc/passwd", "javascript:alert(1)"]) {
      expect(() =>
        decodeUpgradeOffer({ kind: "upgrade-offer", protocolHash: "sha256:00", protocolSource }),
      ).toThrow(TypeError);
    }
  });

  it("an RDF offer needs an http(s) source and an xsd:boolean flag", async () => {
    const offer = (source: string, required: string) =>
      handshakeFromRdf(`@prefix a2a: <https://w3id.org/jeswr/a2a#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<urn:h> a a2a:UpgradeOffer ; a2a:protocolHash "sha256:00" ;
  a2a:protocolSource <${source}> ; a2a:required ${required} .`);
    expect(await offer("https://peer.example/p.ttl", '"false"^^xsd:boolean')).toMatchObject({
      required: false,
    });
    expect(await offer("https://peer.example/p.ttl", '"false"@en')).toBeUndefined();
    expect(await offer("https://peer.example/p.ttl", '"false"')).toBeUndefined();
    expect(await offer("javascript:alert(1)", '"false"^^xsd:boolean')).toBeUndefined();
  });
});
