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
    expect(report.results[0]?.message).toMatch(/evaluations over this intent/);
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
      expect(report.results[0]?.message).toMatch(/evaluations over this intent/);
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

  const quick = async (
    body: string,
    data: Intent | Awaited<ReturnType<typeof parseRdf>> = intent,
  ) => {
    const started = performance.now();
    const report = await validateIntent(
      data,
      await parseRdf(
        `@prefix sh: <http://www.w3.org/ns/shacl#> . @prefix a2a: <https://w3id.org/jeswr/a2a#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix schema: <https://schema.org/> .
${body}`,
        "text/turtle",
      ),
    );
    expect(performance.now() - started).toBeLessThan(2000);
    return report;
  };

  it("counts value nodes: a linear chain over a wide path is refused", async () => {
    const preds = ["rdf:type", "a2a:action", "schema:object", "schema:agent", "a2a:mode"];
    const wide = `[ sh:zeroOrMorePath [ sh:alternativePath ( ${preds.join(" ")} ${preds
      .map((p) => `[ sh:inversePath ${p} ]`)
      .join(" ")} ) ] ]`;
    let body = "<urn:S> a sh:NodeShape ; sh:targetClass a2a:Intent ; sh:property <urn:P0> .\n";
    for (let i = 0; i < 8; i++)
      body += `<urn:P${i}> sh:path ${wide} ; sh:or ( <urn:P${i + 1}> ) .\n`;
    body += "<urn:P8> sh:path rdf:type ; sh:hasValue <urn:none> .";
    const report = await quick(body);
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toMatch(/evaluations over this intent/);
  });

  const loop = "_:l rdf:first <urn:x> ; rdf:rest _:l .";
  for (const [name, body] of [
    ["sh:in", `<urn:S> sh:targetNode <urn:anything> ; sh:in _:l . ${loop}`],
    [
      "a sequence path",
      `<urn:S> sh:targetNode <urn:a> ; sh:property [ sh:path _:l ; sh:minCount 0 ] . ${loop}`,
    ],
    [
      "sh:alternativePath",
      `<urn:S> sh:targetNode <urn:a> ; sh:property [ sh:path [ sh:alternativePath _:l ] ; sh:minCount 0 ] . ${loop}`,
    ],
    [
      "sh:languageIn",
      `<urn:S> sh:targetNode <urn:a> ; sh:languageIn _:l . _:l rdf:first "fr" ; rdf:rest _:l .`,
    ],
    [
      "sh:ignoredProperties",
      `<urn:S> sh:targetClass a2a:Intent ; sh:closed true ; sh:ignoredProperties _:l . ${loop}`,
    ],
  ] as const) {
    it(`refuses a looping list under ${name}`, async () => {
      const report = await quick(body);
      expect(report.conforms).toBe(false);
      expect(report.results[0]?.message).toMatch(/unbounded cost/);
    });
  }

  for (const form of ["alt", "seq"] as const) {
    it(`refuses a property path that shares nodes (${form})`, async () => {
      let body =
        "<urn:S> sh:targetClass a2a:Intent ; sh:property [ sh:path _:p0 ; sh:minCount 0 ] .\n";
      for (let i = 0; i < 20; i++) {
        body +=
          form === "alt"
            ? `_:p${i} sh:alternativePath ( _:p${i + 1} _:p${i + 1} ) .\n`
            : `_:p${i} sh:zeroOrOnePath ( _:p${i + 1} _:p${i + 1} ) .\n`;
      }
      body += `_:p20 sh:inversePath a2a:action .`;
      const report = await quick(body);
      expect(report.conforms).toBe(false);
      expect(report.results[0]?.message).toMatch(/property path/);
    });
  }

  const diamond = (root: string) => {
    let triples = "";
    let previous = [root];
    for (let i = 0; i < 24; i++) {
      const current = [`<urn:c${i}a>`, `<urn:c${i}b>`];
      for (const c of current) for (const p of previous) triples += `${c} rdfs:subClassOf ${p} .\n`;
      previous = current;
    }
    return triples;
  };

  it("refuses subclass reasoning in the shapes graph", async () => {
    const report = await quick(
      `<urn:S> sh:targetClass a2a:Intent ; sh:nodeKind sh:IRI .\n${diamond("rdfs:Class")}`,
    );
    expect(report.conforms).toBe(false);
  });

  it("counts sh:and on a property shape as re-running its members over the same path", async () => {
    const grant: Intent = {
      id: "urn:i:5",
      action: "grant",
      target: "https://alice.example/x",
      recipient: "https://bob.example/#me",
      modes: ["Read", "Write", "Append", "Control"],
    } as Intent;
    let body = "<urn:S> sh:targetSubjectsOf a2a:mode ; sh:path a2a:mode ; sh:and ( <urn:A1> ) .\n";
    for (let i = 1; i < 7; i++) body += `<urn:A${i}> sh:and ( <urn:A${i + 1}> ) .\n`;
    body += "<urn:A7> sh:nodeKind sh:IRI .";
    const report = await quick(body, grant);
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toMatch(/evaluations over this intent/);
  });

  for (const [name, path] of [
    [
      "a repeated path inside a repeated path",
      "[ sh:zeroOrMorePath [ sh:oneOrMorePath a2a:action ] ]",
    ],
    [
      "a path node with two path keys",
      "[ sh:inversePath a2a:none ; sh:zeroOrMorePath a2a:action ]",
    ],
    [
      "a path node with a list and a path key",
      "[ rdf:first a2a:action ; rdf:rest () ; sh:zeroOrOnePath a2a:action ]",
    ],
  ] as const) {
    it(`refuses ${name}`, async () => {
      const report = await quick(
        `<urn:S> sh:targetClass a2a:Intent ; sh:property [ sh:path ${path} ; sh:minCount 0 ] .`,
      );
      expect(report.conforms).toBe(false);
      expect(report.results[0]?.message).toMatch(/property path/);
    });
  }

  it("reads a named path as a predicate, as the validator does, even if it heads a list", async () => {
    let data = "";
    for (let i = 0; i < 30; i++)
      for (let j = 0; j < 30; j++) data += `<urn:a${i}> <urn:ex:fake> <urn:a${j}> .\n`;
    let body =
      "<urn:ex:fake> rdf:first <urn:ex:none> ; rdf:rest () .\n<urn:S0> sh:targetNode <urn:a0> ; sh:or ( <urn:S1> ) .\n";
    for (let k = 1; k <= 3; k++)
      body += `<urn:S${k}> sh:path <urn:ex:fake> ; ${k < 3 ? `sh:or ( <urn:S${k + 1}> )` : "sh:nodeKind sh:IRI"} .\n`;
    const report = await quick(body, await parseRdf(data, "text/turtle"));
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toMatch(/evaluations over this intent/);
  });

  it("refuses a repeated constraint parameter (one constraint per combination)", async () => {
    const report = await quick(
      "<urn:S> sh:targetClass a2a:Intent ; sh:property [ sh:path [ sh:zeroOrOnePath a2a:none ] ; sh:qualifiedValueShape [ sh:nodeKind sh:IRI ] ; sh:qualifiedMinCount 0, 1, 2 ] .",
    );
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toMatch(/repeating/);
  });

  it("charges each walk of a repeated path", async () => {
    let data = "";
    for (let i = 0; i < 600; i++) data += `<urn:n${i}> <urn:ex:p> <urn:n${i + 1}> .\n`;
    const report = await quick(
      "<urn:S> sh:targetNode <urn:n0> ; sh:property [ sh:path [ sh:zeroOrMorePath <urn:ex:p> ] ; sh:minCount 0 ; sh:uniqueLang true ; sh:disjoint <urn:ex:q> ] .",
      await parseRdf(data, "text/turtle"),
    );
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toMatch(/evaluations over this intent/);
  });

  it("stops a validation whose results outgrow the graph-operation budget", async () => {
    // Each sh:class value is its own constraint at every value node, with a
    // result per failure: 200 x 200 results, which the step model does not see.
    let data = "";
    for (let i = 0; i < 200; i++) data += `<urn:d${i}> <urn:ex:p> "x" .\n`;
    const classes = Array.from({ length: 200 }, (_, i) => `<urn:C${i}>`).join(", ");
    const report = await quick(
      `<urn:S> sh:targetSubjectsOf <urn:ex:p> ; sh:class ${classes} .`,
      await parseRdf(data, "text/turtle"),
    );
    expect(report.conforms).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.message).toMatch(/graph operations are not evaluated/);
  });

  for (const [name, body, data] of [
    [
      "a long typed literal (backtracking lexical pattern)",
      "<urn:S> sh:targetNode <urn:f> ; sh:path <urn:ex:p> ; sh:datatype <http://www.w3.org/2001/XMLSchema#double> .",
      `<urn:f> <urn:ex:p> "${"1".repeat(20_000)}x"^^<http://www.w3.org/2001/XMLSchema#double> .`,
    ],
    [
      "a long term (serialised on every shape evaluation)",
      "<urn:S> sh:targetObjectsOf <urn:ex:p> ; sh:nodeKind sh:Literal .",
      `<urn:s> <urn:ex:p> "${"v".repeat(10_000)}" .`,
    ],
    [
      "a long language tag on a short literal",
      "<urn:S> sh:targetObjectsOf <urn:ex:p> ; sh:nodeKind sh:Literal .",
      `<urn:s> <urn:ex:p> "v"@${"abcdefgh-".repeat(5)}x .`,
    ],
    [
      "a long datatype IRI on a short literal",
      "<urn:S> sh:targetObjectsOf <urn:ex:p> ; sh:nodeKind sh:Literal .",
      `<urn:s> <urn:ex:p> "v"^^<urn:dt:${"d".repeat(5_000)}> .`,
    ],
    [
      "a long sh:message (copied into every result)",
      `<urn:S> sh:targetSubjectsOf <urn:ex:p> ; sh:nodeKind sh:Literal ; sh:message "${"x".repeat(2_000)}" .`,
      "<urn:s> <urn:ex:p> <urn:o> .",
    ],
  ] as const) {
    it(`refuses ${name}`, async () => {
      const report = await quick(body, await parseRdf(data, "text/turtle"));
      expect(report.conforms).toBe(false);
      expect(report.results).toHaveLength(1);
      expect(report.results[0]?.message).toMatch(
        /(characters|tags over \d+ characters) are not evaluated/,
      );
    });
  }

  it("charges pairwise comparisons even when every comparison passes", async () => {
    let data = "";
    for (let i = 0; i < 80; i++)
      data += `<urn:f> <urn:ex:p> "a${i}" .\n<urn:f> <urn:ex:r> "z${i}" .\n`;
    const report = await quick(
      "<urn:S> sh:targetNode <urn:f> ; sh:path <urn:ex:p> ; sh:lessThan <urn:ex:r> .",
      await parseRdf(data, "text/turtle"),
    );
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toMatch(/evaluations over this intent/);
  });

  it("caps a list however its cells are first reached", async () => {
    // A 300-cell list whose tail (200 cells) another shape walks first.
    let cells = "";
    for (let i = 0; i < 300; i++)
      cells += `<urn:c${i}> rdf:first "v${i}" ; rdf:rest ${i < 299 ? `<urn:c${i + 1}>` : "rdf:nil"} .\n`;
    for (const order of [
      "<urn:A> sh:targetNode <urn:x> ; sh:in <urn:c100> .\n<urn:B> sh:targetNode <urn:x> ; sh:in <urn:c0> .",
      "<urn:B> sh:targetNode <urn:x> ; sh:in <urn:c0> .\n<urn:A> sh:targetNode <urn:x> ; sh:in <urn:c100> .",
    ]) {
      const report = await quick(`${order}\n${cells}`);
      expect(report.conforms).toBe(false);
      expect(report.results[0]?.message).toMatch(/list/);
    }
  });

  it("keeps literals with the same text but another datatype or language apart", async () => {
    let data = "";
    for (let i = 0; i < 80; i++)
      data += `<urn:f> <urn:ex:p> "a"^^<urn:dt:${i}> .\n<urn:f> <urn:ex:r> "z"@en-v${i} .\n`;
    const report = await quick(
      "<urn:S> sh:targetNode <urn:f> ; sh:path [ sh:zeroOrOnePath <urn:ex:p> ] ; sh:lessThan <urn:ex:r> .",
      await parseRdf(data, "text/turtle"),
    );
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toMatch(/evaluations over this intent/);
  });

  it("reads an sh:alternativePath list with a named head, as the validator does", async () => {
    const report = await quick(
      `<urn:S> sh:targetClass a2a:Intent ; sh:property [ sh:path [ sh:alternativePath <urn:alts> ] ; sh:minCount 1 ] .
<urn:alts> rdf:first a2a:action ; rdf:rest () .`,
    );
    expect(report.conforms).toBe(true);
  });

  it("refuses subclass reasoning in the intent graph, even against the package's own shapes", async () => {
    const data = await parseRdf(
      `@prefix a2a: <https://w3id.org/jeswr/a2a#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix schema: <https://schema.org/> .
<urn:i:5> a a2a:Intent ; a2a:action [ a schema:ReadAction ; schema:object <https://alice.example/x> ] .
${diamond("a2a:Intent")}`,
      "text/turtle",
    );
    const started = performance.now();
    const report = await validateIntent(data, buildShapeForIntent("read"));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toMatch(/rdfs:subClassOf/);
  });

  it("still evaluates bounded paths, lists and logical shapes", async () => {
    const report = await quick(
      `<urn:S> sh:targetClass a2a:Intent ; sh:property [
  sh:path ( a2a:action [ sh:alternativePath ( schema:object schema:target ) ] ) ;
  sh:minCount 1 ; sh:nodeKind sh:IRI ;
  sh:not [ sh:in ( <https://mallory.example/x> ) ]
] ; sh:or ( [ sh:nodeKind sh:IRI ] [ sh:nodeKind sh:BlankNode ] ) .`,
    );
    expect(report.conforms).toBe(true);
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
