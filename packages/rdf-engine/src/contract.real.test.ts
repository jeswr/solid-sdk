// AUTHORED-BY Codex GPT-6.1-Sol
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
