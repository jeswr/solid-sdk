// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import SHACLValidator from "rdf-validate-shacl";
import { describe, expect, it } from "vitest";
import { canonicalNQuads, hashQuads, validateIntent } from "../src/index.js";
import { A2A, LEGACY_A2A_NS, RDF, RDFS, SH } from "../src/vocab.js";

const variants = [
  { name: "legacy", data: LEGACY_A2A_NS, types: LEGACY_A2A_NS, shape: LEGACY_A2A_NS },
  { name: "canonical", data: A2A, types: A2A, shape: A2A },
  { name: "legacy data / canonical shape", data: LEGACY_A2A_NS, types: LEGACY_A2A_NS, shape: A2A },
  { name: "canonical data / legacy shape", data: A2A, types: A2A, shape: LEGACY_A2A_NS },
  { name: "mixed", data: LEGACY_A2A_NS, types: A2A, shape: LEGACY_A2A_NS },
  { name: "mixed with duplicate aliases", data: A2A, types: LEGACY_A2A_NS, shape: A2A, both: true },
];

const restrictions = [
  { name: "sequence path", path: "(v:action v:mode)", constraint: "sh:maxCount 0" },
  {
    name: "alternative path",
    path: "[ sh:alternativePath (v:action v:mode) ]",
    constraint: "sh:maxCount 0",
  },
  { name: "inverse path", path: "[ sh:inversePath v:incoming ]", constraint: "sh:maxCount 0" },
  { name: "one-or-more path", path: "[ sh:oneOrMorePath v:action ]", constraint: "sh:maxCount 0" },
  {
    name: "zero-or-more path",
    path: "[ sh:zeroOrMorePath v:action ]",
    constraint: "sh:maxCount 1",
  },
  { name: "zero-or-one path", path: "[ sh:zeroOrOnePath v:action ]", constraint: "sh:maxCount 1" },
  {
    name: "nested path",
    path: "([ sh:alternativePath (v:action v:parameter) ] [ sh:oneOrMorePath v:mode ])",
    constraint: "sh:maxCount 0",
  },
  { name: "disjoint", path: "v:action", constraint: "sh:disjoint v:mode" },
  { name: "equals", path: "v:missing", constraint: "sh:equals v:mode" },
  { name: "lessThan", path: "v:paramValue", constraint: "sh:lessThan v:paramKey" },
  { name: "lessThanOrEquals", path: "v:paramValue", constraint: "sh:lessThanOrEquals v:paramKey" },
  { name: "class", path: "v:action", constraint: "sh:not [ sh:class v:GrantAction ]" },
  { name: "in class list", path: "rdf:type", constraint: "sh:not [ sh:in (v:Intent) ]" },
  { name: "hasValue class", path: "rdf:type", constraint: "sh:not [ sh:hasValue v:Intent ]" },
];

describe.each(variants)("restrictive SHACL aliases: $name", (variant) => {
  it.each(restrictions)("rejects $name just as raw SHACL rejects the canonical equivalent", async ({
    path,
    constraint,
  }) => {
    function data(ns: string, types: string, both = false) {
      return `@prefix v: <${ns}> . @prefix c: <${types}> .
        <urn:focus> a c:Intent ; v:action <urn:action> ; v:mode <urn:action> ;
          v:paramValue 9 ; v:paramKey 3 .
        <urn:action> a c:GrantAction ; v:mode <urn:mode> .
        <urn:other> v:incoming <urn:focus> .
        ${
          both
            ? `<urn:focus> a <${A2A}Intent> ; <${LEGACY_A2A_NS}action> <urn:action> ;
          <${LEGACY_A2A_NS}mode> <urn:action> ; <${LEGACY_A2A_NS}paramValue> 9 ;
          <${LEGACY_A2A_NS}paramKey> 3 .`
            : ""
        }`;
    }
    function shape(ns: string) {
      return `@prefix v: <${ns}> . @prefix sh: <${SH}> . @prefix rdf: <${RDF}> .
        <urn:shape> a sh:NodeShape ; sh:targetClass v:Intent ;
          sh:property [ sh:path ${path} ; ${constraint} ] .`;
    }
    const canonicalData = await parseRdf(data(A2A, A2A), "text/turtle", {});
    const canonicalShape = await parseRdf(shape(A2A), "text/turtle", {});
    expect((await new SHACLValidator(canonicalShape).validate(canonicalData)).conforms).toBe(false);

    const graph = await parseRdf(
      data(variant.data, variant.types, variant.both),
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(shape(variant.shape), "text/turtle", {});
    // In particular, the reproduced legacy-only cases must fail BEFORE aliasing too.
    if (variant.name === "legacy") {
      expect((await new SHACLValidator(shapes).validate(graph)).conforms).toBe(false);
    }
    const originalData = await canonicalNQuads([...graph]);
    const originalShapeHash = await hashQuads([...shapes]);
    const report = await validateIntent(graph, shapes);
    expect(report.conforms).toBe(false);
    expect(report.results.length).toBeGreaterThan(0);
    expect(await canonicalNQuads([...graph])).toBe(originalData);
    expect(await hashQuads([...shapes])).toBe(originalShapeHash);
  });

  it("accepts vocabulary lists and closed shapes with ignored vocabulary properties", async () => {
    const graph = await parseRdf(
      `<urn:focus> a <${variant.types}Intent> ; <${variant.data}mode> 3 .`,
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(
      `@prefix v: <${variant.shape}> . @prefix sh: <${SH}> . @prefix rdf: <${RDF}> .
      <urn:shape> a sh:NodeShape ; sh:targetClass v:Intent ; sh:closed true ;
        sh:ignoredProperties (rdf:type v:mode) ;
        sh:property [ sh:path rdf:type ; sh:in (v:Intent) ;
          sh:node [ sh:in (v:Intent) ] ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(true);
  });
});

describe("uniform SHACL namespace renaming", () => {
  it.each([
    "class",
    "targetClass",
  ])("follows mixed class hierarchies through blank nodes for sh:%s", async (constraint) => {
    const graph = await parseRdf(
      `<urn:focus> a <${LEGACY_A2A_NS}SubIntent> .
        <${LEGACY_A2A_NS}SubIntent> <${RDFS}subClassOf> _:middle .
        _:middle <${RDFS}subClassOf> <${A2A}Intent> .`,
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> .
      <urn:shape> a sh:NodeShape ; ${
        constraint === "class"
          ? `sh:targetNode <urn:focus> ; sh:not [ sh:class <${LEGACY_A2A_NS}Intent> ]`
          : `sh:targetClass <${LEGACY_A2A_NS}Intent> ; sh:property [ sh:path <${A2A}action> ; sh:minCount 1 ]`
      } .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(false);
  });

  it("fails closed when class-axiom subject identities would collapse", async () => {
    const graph = await parseRdf(
      `<${LEGACY_A2A_NS}SubIntent> <${RDFS}subClassOf> <${LEGACY_A2A_NS}Intent> .
        <${A2A}SubIntent> <${A2A}mode> 3 .`,
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> .
      <urn:shape> a sh:NodeShape ; sh:targetNode <${LEGACY_A2A_NS}SubIntent> ;
        sh:property [ sh:path <${A2A}mode> ; sh:minCount 1 ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(false);
  });

  it.each([LEGACY_A2A_NS, A2A])("uses aliased class hierarchies for sh:class (%s)", async (ns) => {
    const graph = await parseRdf(
      `<urn:focus> a <${ns}SubIntent> .
        <${ns}SubIntent> <${RDFS}subClassOf> <${ns}Intent> .`,
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> .
      <urn:shape> a sh:NodeShape ; sh:targetNode <urn:focus> ;
        sh:not [ sh:class <${LEGACY_A2A_NS}Intent> ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(false);
  });

  it.each([
    LEGACY_A2A_NS,
    A2A,
  ])("applies the same renaming to implicit class targets (%s)", async (ns) => {
    const graph = await parseRdf(`<urn:focus> a <${ns}Intent> .`, "text/turtle", {});
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> .
      <${LEGACY_A2A_NS}Intent> a sh:NodeShape, <${RDFS}Class> ;
        sh:property [ sh:path <${LEGACY_A2A_NS}action> ; sh:minCount 1 ] .`,
      "text/turtle",
      {},
    );
    const report = await validateIntent(graph, shapes);
    expect(report.conforms).toBe(false);
    expect(report.results.some((result) => result.focusNode === "urn:focus")).toBe(true);
  });

  it.each([
    "node",
    "not",
    "and",
    "or",
    "xone",
  ])("renames a shared named shape uniformly in class and resource constraints (sh:%s)", async (link) => {
    const graph = await parseRdf(
      `<urn:focus> a <${LEGACY_A2A_NS}Intent> ; <${A2A}action> <${LEGACY_A2A_NS}Intent> .`,
      "text/turtle",
      {},
    );
    const ref = `<${LEGACY_A2A_NS}constraint>`;
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> . @prefix rdf: <${RDF}> .
        <urn:shape> a sh:NodeShape ; sh:targetNode <urn:focus> ;
          sh:property [ sh:path rdf:type ; sh:${link} ${["and", "or", "xone"].includes(link) ? `(${ref})` : ref} ],
            [ sh:path <${A2A}action> ; sh:node ${ref} ] .
        ${ref} sh:targetNode <${LEGACY_A2A_NS}Intent> ; sh:in (<${LEGACY_A2A_NS}Intent>) .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(link !== "not");
  });

  it.each([
    `(<${LEGACY_A2A_NS}action> rdf:type)`,
    `(<${LEGACY_A2A_NS}action> [ sh:oneOrMorePath rdf:type ])`,
    `(<${LEGACY_A2A_NS}action> [ sh:alternativePath (rdf:type rdf:type) ])`,
    `(<${LEGACY_A2A_NS}action> rdf:type [ sh:zeroOrMorePath rdf:type ])`,
    `(<${LEGACY_A2A_NS}action> rdf:type [ sh:zeroOrOnePath rdf:type ])`,
  ])("renames all values returned by %s", async (path) => {
    const graph = await parseRdf(
      `<urn:focus> <${A2A}action> <urn:action> ; <${A2A}mode> <${LEGACY_A2A_NS}GrantAction> .
        <urn:action> a <${LEGACY_A2A_NS}GrantAction> .`,
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> . @prefix rdf: <${RDF}> .
      <urn:shape> a sh:NodeShape ; sh:targetNode <urn:focus> ;
        sh:property [ sh:path ${path} ;
          sh:not [ sh:in (<${LEGACY_A2A_NS}GrantAction>) ] ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(false);
  });

  it.each([
    "targetSubjectsOf",
    "targetObjectsOf",
  ])("normalizes sh:%s vocabulary operands", async (target) => {
    const graph = await parseRdf(
      `<urn:focus> <${LEGACY_A2A_NS}action> <urn:action> ; <${A2A}mode> 3 .
        <urn:action> <${LEGACY_A2A_NS}mode> 3 .`,
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> .
      <urn:shape> a sh:NodeShape ; sh:${target} <${LEGACY_A2A_NS}action> ;
        sh:property [ sh:path <${LEGACY_A2A_NS}mode> ; sh:maxCount 0 ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(false);
  });

  it("normalizes mixed vocabulary terms within a path expression", async () => {
    const graph = await parseRdf(
      `<urn:focus> <${A2A}action> <urn:action> .
        <urn:action> <${LEGACY_A2A_NS}mode> <urn:mode> .`,
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> .
      <urn:shape> a sh:NodeShape ; sh:targetNode <urn:focus> ;
        sh:property [ sh:path (<${LEGACY_A2A_NS}action> <${A2A}mode>) ; sh:maxCount 0 ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(false);
  });

  it("renames a targetNode absent from the data graph consistently in value constraints", async () => {
    const graph = await parseRdf("", "text/turtle", {});
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> .
      <urn:shape> a sh:NodeShape ; sh:targetNode <${LEGACY_A2A_NS}resource> ;
        sh:in (<${LEGACY_A2A_NS}resource>) ; sh:hasValue <${LEGACY_A2A_NS}resource> .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(true);
  });

  it.each([
    "node",
    "not",
    "qualifiedValueShape",
  ])("renames named sh:%s references", async (link) => {
    const graph = await parseRdf(`<urn:focus> <${A2A}action> <urn:action> .`, "text/turtle", {});
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> .
      <urn:shape> a sh:NodeShape ; sh:targetNode <urn:focus> ;
        ${link === "qualifiedValueShape" ? `sh:property [ sh:path <${LEGACY_A2A_NS}action> ;` : ""}
        sh:${link} <${LEGACY_A2A_NS}constraint>
        ${link === "qualifiedValueShape" ? "; sh:qualifiedMinCount 1 ]" : ""} .
      <${LEGACY_A2A_NS}constraint> sh:property [ sh:path <${LEGACY_A2A_NS}missing> ; sh:minCount 1 ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(link === "not");
  });

  it.each(["and", "or", "xone"])("renames named shapes in sh:%s lists", async (link) => {
    const graph = await parseRdf(`<urn:focus> <${A2A}action> <urn:action> .`, "text/turtle", {});
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> .
      <urn:shape> a sh:NodeShape ; sh:targetNode <urn:focus> ; sh:${link} (<${LEGACY_A2A_NS}constraint>) .
      <${LEGACY_A2A_NS}constraint> sh:property [ sh:path <${LEGACY_A2A_NS}missing> ; sh:minCount 1 ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(false);
  });

  it.each([
    LEGACY_A2A_NS,
    A2A,
  ])("renames resource identities consistently in sh:in and sh:hasValue (%s)", async (required) => {
    const graph = await parseRdf(
      `<urn:focus> <${A2A}action> <${LEGACY_A2A_NS}resource> .`,
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> .
      <urn:shape> a sh:NodeShape ; sh:targetNode <urn:focus> ;
        sh:property [ sh:path <${LEGACY_A2A_NS}action> ;
          sh:hasValue <${required}resource> ; sh:in (<${required}resource>) ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(true);
  });

  it("renames a shared list uniformly in vocabulary and resource contexts", async () => {
    const graph = await parseRdf(
      `<urn:focus> a <${LEGACY_A2A_NS}Intent> ; <${A2A}action> <${LEGACY_A2A_NS}Intent> .`,
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> . @prefix rdf: <${RDF}> .
      <urn:shape> a sh:NodeShape ; sh:targetNode <urn:focus> ;
        sh:property [ sh:path rdf:type ; sh:in _:shared ],
          [ sh:path <${LEGACY_A2A_NS}action> ; sh:in _:shared ] .
      _:shared rdf:first <${LEGACY_A2A_NS}Intent> ; rdf:rest rdf:nil .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(true);
  });
});

// Round 3: an alternative path mixes classes and ordinary values. Its semantics
// must not depend on whether an unrelated triple happens to use the same class.
describe("SHACL uniform renaming regressions", () => {
  it.each(variants)("rejects class/resource alternative-path bypass ($name)", async (variant) => {
    const graph = await parseRdf(
      `<urn:focus> a <${variant.types}Intent> .
       <urn:unrelated> <${variant.data}mode> <${variant.types}Intent> .`,
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(
      `@prefix v: <${variant.shape}> . @prefix sh: <${SH}> . @prefix rdf: <${RDF}> .
       <urn:shape> a sh:NodeShape ; sh:targetNode <urn:focus> ;
         sh:property [ sh:path [ sh:alternativePath (rdf:type v:action) ] ;
           sh:not [ sh:in (v:Intent) ] ] .`,
      "text/turtle",
      {},
    );
    if (variant.name === "legacy" || variant.name === "canonical") {
      expect((await new SHACLValidator(shapes).validate(graph)).conforms).toBe(false);
    }
    const report = await validateIntent(graph, shapes);
    expect(report.conforms).toBe(false);
    expect(report.results.length).toBeGreaterThan(0);
  });

  it.each([
    `<${LEGACY_A2A_NS}x> <urn:p> 1 . <${A2A}x> <urn:p> 2 .`,
    `<urn:s> <urn:p> <${LEGACY_A2A_NS}x>, <${A2A}x> .`,
    `<${LEGACY_A2A_NS}x> <urn:p> 1 . <urn:s> <urn:p> <${A2A}x> .`,
    `<urn:s> <urn:p> <${LEGACY_A2A_NS}x> . <${A2A}x> <urn:p> 1 .`,
  ])("fails closed on identity collisions even without a restricting shape: %s", async (body) => {
    const graph = await parseRdf(body, "text/turtle", {});
    const shapes = await parseRdf("", "text/turtle", {});
    const before = await canonicalNQuads([...graph]);
    const report = await validateIntent(graph, shapes);
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toContain("distinct data nodes");
    expect(await canonicalNQuads([...graph])).toBe(before);
  });

  it("accepts pure predicate/class mixing even when the same terms occur in other positions", async () => {
    const graph = await parseRdf(
      `<urn:focus> a <${LEGACY_A2A_NS}Intent>, <${A2A}Intent> ;
        <${LEGACY_A2A_NS}action> <urn:action> ; <${A2A}action> <urn:action> .
       <${LEGACY_A2A_NS}Intent> <urn:p> <${A2A}action> .`,
      "text/turtle",
      {},
    );
    const shapes = await parseRdf(
      `@prefix sh: <${SH}> .
       <urn:shape> a sh:NodeShape ; sh:targetClass <${A2A}Intent> ;
         sh:property [ sh:path <${LEGACY_A2A_NS}action> ; sh:minCount 1 ; sh:maxCount 1 ] .`,
      "text/turtle",
      {},
    );
    expect((await validateIntent(graph, shapes)).conforms).toBe(true);
  });
});

it("uniformly renames graph names and literal datatypes while preserving literal values", async () => {
  const { validationDataset } = await import("../src/validationDataset.js");
  const graph = await parseRdf(
    `<${LEGACY_A2A_NS}graph> {
      <${LEGACY_A2A_NS}subject> <${LEGACY_A2A_NS}property>
        "value"^^<${LEGACY_A2A_NS}Datatype>, "bonjour"@fr, "${LEGACY_A2A_NS}literal" .
    }`,
    "application/trig",
    {},
  );
  const view = validationDataset(graph);
  expect(view).toBeDefined();
  const quads = [...(view ?? [])];
  expect(quads).toHaveLength(3);
  for (const quad of quads) {
    expect(quad.subject.value).toBe(`${A2A}subject`);
    expect(quad.predicate.value).toBe(`${A2A}property`);
    expect(quad.graph.value).toBe(`${A2A}graph`);
  }
  expect(
    quads.some(
      (q) => q.object.termType === "Literal" && q.object.datatype.value === `${A2A}Datatype`,
    ),
  ).toBe(true);
  expect(quads.some((q) => q.object.termType === "Literal" && q.object.language === "fr")).toBe(
    true,
  );
  expect(quads.some((q) => q.object.value === `${LEGACY_A2A_NS}literal`)).toBe(true);
});
