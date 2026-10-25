// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Store } from "n3";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createRdfEngine } from "./node.js";
import type { RdfEngine } from "./types.js";

let engine: RdfEngine;
beforeEach(() => {
  engine = createRdfEngine();
});
afterEach(() => {
  engine.dispose();
});

test("JSON-LD resolves relative identifiers against the supplied base", async () => {
  const data = await engine.parse(
    '{"@id":"#me","https://example/name":"Alice"}',
    "application/ld+json",
    { baseIri: "https://example/profile" },
  );
  expect(await engine.canonicalize(data)).toBe(
    '<https://example/profile#me> <https://example/name> "Alice" .\n',
  );
});

test("JSON-LD base resolution preserves default and named graphs", async () => {
  const input = JSON.stringify([
    { "@id": "#me", "https://example/name": "Alice" },
    {
      "@id": "#graph",
      "@graph": [{ "@id": "#me", "https://example/knows": { "@id": "friend" } }],
    },
  ]);
  const data = await engine.parse(new TextEncoder().encode(input), "application/ld+json", {
    baseIri: "https://example/profile",
  });
  expect(await engine.canonicalize(data)).toBe(
    "<https://example/profile#me> <https://example/knows> <https://example/friend> <https://example/profile#graph> .\n" +
      '<https://example/profile#me> <https://example/name> "Alice" .\n',
  );
});

test("JSON-LD explicit base directives override or clear the supplied base", async () => {
  for (const base of ["https://other.example/", null]) {
    const data = await engine.parse(
      JSON.stringify({
        "@context": { "@base": base },
        "@id": "#me",
        "https://example/name": "Alice",
      }),
      "application/ld+json",
      { baseIri: "https://example/profile" },
    );
    expect(await engine.canonicalize(data)).toBe(
      base ? '<https://other.example/#me> <https://example/name> "Alice" .\n' : "",
    );
  }
});

test("JSON-LD base resolution leaves JSON literal values intact", async () => {
  const value = { "@context": null, nested: [null, { "@id": "#literal" }] };
  const data = await engine.parse(
    JSON.stringify({
      "@context": { value: "@value", type: "@type" },
      "@id": "#me",
      "https://example/value": { value, type: "@json" },
    }),
    "application/ld+json",
    { baseIri: "https://example/profile" },
  );
  expect(data.size).toBe(1);
  expect(JSON.parse([...data][0]?.object.value ?? "")).toEqual(value);
});

test("JSON-LD parse and serialize preserve literal types, language and named graphs", async () => {
  const input = JSON.stringify({
    "@id": "https://example/g",
    "@graph": [
      {
        "@id": "https://example/s",
        "https://example/name": [{ "@value": "Bonjour", "@language": "fr" }],
        "https://example/age": [
          { "@value": "42", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
        ],
      },
    ],
  });
  const data = await engine.parse(input, "application/ld+json");
  expect(data.size).toBe(2);
  expect([...data].every((q) => q.graph.value === "https://example/g")).toBe(true);
  const output = await engine.serialize(data, "application/ld+json", { pretty: false });
  expect(JSON.parse(output)).toBeDefined();
  expect(await engine.canonicalize(await engine.parse(output, "application/ld+json"))).toBe(
    await engine.canonicalize(data),
  );
});

test("JSON-LD blank nodes are scoped to each parsed document", async () => {
  const input = JSON.stringify({ "@id": "_:s", "https://example/p": { "@id": "_:s" } });
  const first = await engine.parse(input, "application/ld+json");
  const second = await engine.parse(input, "application/ld+json");
  const union = new Store([...first, ...second]);
  expect(union.size).toBe(2);
  expect(new Set([...union].map((quad) => quad.subject.value)).size).toBe(2);
  expect([...union].every((quad) => quad.subject.equals(quad.object))).toBe(true);
});

test.each([
  [
    "triple-term object",
    "<https://example/s> <https://example/p> <<( <https://example/a> <https://example/b> <https://example/c> )>> .",
    "Unsupported RDF term type: triple",
  ],
  [
    "triple-term object in a named graph",
    "<https://example/g> { <https://example/s> <https://example/p> <<( <https://example/a> <https://example/b> <https://example/c> )>> . }",
    "Unsupported RDF term type: triple",
  ],
  [
    "left-to-right literal",
    '<https://example/s> <https://example/p> "v"@en--ltr .',
    "Unsupported RDF literal direction: ltr",
  ],
  [
    "right-to-left literal in a named graph",
    '<https://example/g> { <https://example/s> <https://example/p> "v"@ar--rtl . }',
    "Unsupported RDF literal direction: rtl",
  ],
])("rejects an unsupported %s without returning altered RDF", async (_name, input, message) => {
  await expect(engine.parse(input, "application/trig")).rejects.toThrow(message);
});

const shapes = `@prefix sh: <http://www.w3.org/ns/shacl#> .
  <https://example/Shape> a sh:NodeShape; sh:targetNode <https://example/s>;
  sh:property [ sh:path <https://example/name>; sh:minCount 1 ] .`;

test("SHACL reports both conforming and nonconforming data with Turtle or dataset shapes", async () => {
  const valid = await engine.parse(
    '<https://example/s> <https://example/name> "Jesse" .',
    "text/turtle",
  );
  expect(await engine.validate(valid, shapes)).toEqual({ conforms: true, results: [] });
  const invalid = await engine.validate([], await engine.parse(shapes, "text/turtle"));
  expect(invalid.conforms).toBe(false);
  expect(invalid.results).toHaveLength(1);
  expect(invalid.results[0]).toMatchObject({
    focusNode: "<https://example/s>",
    sourceConstraintComponent: "http://www.w3.org/ns/shacl#MinCountConstraintComponent",
  });
  await expect(engine.validate([], "malformed shapes")).rejects.toThrow();
});

test("RDFC-1.0 canonicalization ignores blank-node labels and input order", async () => {
  const first = await engine.parse(
    '_:a <https://example/p> _:b .\n_:b <https://example/p> "value" .',
    "application/n-quads",
  );
  const second = await engine.parse(
    '_:y <https://example/p> "value" .\n_:x <https://example/p> _:y .',
    "application/n-quads",
  );
  const canonical = await engine.canonicalize(first);
  expect(canonical).toContain("_:c14n");
  expect(await engine.canonicalize(second)).toBe(canonical);
});
