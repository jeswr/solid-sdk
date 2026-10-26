// AUTHORED-BY Codex GPT-6.1-Sol
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

test.each([
  { context: null },
  { context: [{ "@base": "https://other.example/" }, null] },
  { context: [{ "@base": null }, null] },
])("JSON-LD context reset $context retains the original document base", async ({ context }) => {
  const data = await engine.parse(
    JSON.stringify({
      "@context": context,
      "@id": "#me",
      "https://example/p": "value",
    }),
    "application/ld+json",
    { baseIri: "https://example/profile" },
  );
  expect(await engine.canonicalize(data)).toBe(
    '<https://example/profile#me> <https://example/p> "value" .\n',
  );
});

test("nested JSON-LD context resets restore the document base after a local override", async () => {
  const data = await engine.parse(
    JSON.stringify({
      "@context": { "@base": "https://other.example/" },
      "@id": "#parent",
      "https://example/p": {
        "@context": null,
        "@id": "#me",
        "https://example/p": "value",
      },
    }),
    "application/ld+json",
    { baseIri: "https://example/profile" },
  );
  expect(await engine.canonicalize(data)).toBe(
    '<https://example/profile#me> <https://example/p> "value" .\n' +
      "<https://other.example/#parent> <https://example/p> <https://example/profile#me> .\n",
  );
});

test.each([
  {
    "@context": null,
    "@id": "#graph",
    "@graph": [{ "@id": "#me", "https://example/p": "value" }],
  },
  {
    "@context": [{ graph: "@graph" }, null],
    "@id": "#graph",
    "@graph": [{ "@id": "#me", "https://example/p": "value" }],
  },
  {
    "@context": { graph: "@graph" },
    "@id": "#graph",
    graph: [{ "@context": null, "@id": "#me", "https://example/p": "value" }],
  },
  {
    "@context": {
      graphs: { "@id": "https://example/graphs", "@container": ["@graph", "@id"] },
    },
    "@id": "#parent",
    graphs: { "#graph": [{ "@context": [null], "@id": "#me", "https://example/p": "value" }] },
  },
])("JSON-LD rejects graph syntax combined with a base and null contexts: %j", async (input) => {
  await expect(
    engine.parse(JSON.stringify(input), "application/ld+json", {
      baseIri: "https://example/profile",
    }),
  ).rejects.toThrow("Sparq 0.1.5 cannot combine a JSON-LD base, graph syntax and null contexts");
});

test("JSON-LD graph syntax with null contexts remains supported without a supplied base", async () => {
  const data = await engine.parse(
    JSON.stringify({
      "@context": null,
      "@id": "https://example/g",
      "@graph": [{ "@id": "https://example/s", "https://example/p": "value" }],
    }),
    "application/ld+json",
  );
  expect(await engine.canonicalize(data)).toBe(
    '<https://example/s> <https://example/p> "value" <https://example/g> .\n',
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

test("LocalIndex SELECT/ASK/CONSTRUCT correctness over 1000 resource graphs", async () => {
  const index = await engine.createIndex();
  const data = await engine.parse(
    '<https://example/s> <https://example/p> "bonjour"@fr .',
    "text/turtle",
  );
  await Promise.all(
    Array.from({ length: 1000 }, (_, i) => index.put(`https://example/${i}`, data)),
  );
  const query = "SELECT ?g ?s ?p ?o WHERE { GRAPH ?g { ?s ?p ?o } } ORDER BY ?g";
  const rows = await index.select(query);
  expect(rows).toHaveLength(1000);
  expect(new Set(rows.map((row) => row.get("g")?.value)).size).toBe(1000);
  expect(rows[0]?.get("o")).toMatchObject({
    termType: "Literal",
    value: "bonjour",
    language: "fr",
  });
  expect(rows[0]?.get("s")?.value).toBe("https://example/s");
  expect(rows[0]?.get("p")?.value).toBe("https://example/p");
  expect(rows[0]?.get("unbound")).toBeUndefined();
  const streamed = [];
  for await (const row of await index.selectStream(query)) streamed.push(row);
  expect(streamed).toHaveLength(1000);
  expect(streamed.every((row, i) => row.equals(rows[i]))).toBe(true);
  const ask = 'ASK { GRAPH <https://example/0> { ?s <https://example/p> "bonjour"@fr } }';
  expect(await index.ask(ask)).toBe(true);
  const result = await index.construct("CONSTRUCT { ?s ?p ?o } WHERE { GRAPH ?g { ?s ?p ?o } }");
  expect(result).toHaveLength(1);
  expect(result[0]?.graph.termType).toBe("DefaultGraph");
  expect(await engine.canonicalize(result)).toBe(await engine.canonicalize(data));
  await index.put(
    "https://example/0",
    await engine.parse("<https://example/new> <https://example/p> 42 .", "text/turtle"),
  );
  expect(await index.ask(ask)).toBe(false);
  expect(
    (await index.select("SELECT ?o { GRAPH <https://example/0> { ?s ?p ?o } }"))[0]?.get("o"),
  ).toMatchObject({
    value: "42",
    datatype: { value: "http://www.w3.org/2001/XMLSchema#integer" },
  });
  for (let i = 0; i < 1000; i += 2) await index.remove(`https://example/${i}`);
  expect(await index.select(query)).toHaveLength(500);
  const restored = await engine.createIndex();
  await restored.restore(await index.snapshot());
  expect(await restored.select(query)).toEqual(await index.select(query));
});

test("LocalIndex preserves blank nodes across rows, OPTIONAL unbound variables and restores", async () => {
  const index = await engine.createIndex();
  await index.put(
    "https://example/g",
    await engine.parse('_:a <https://example/p> _:a; <https://example/label> "x" .', "text/turtle"),
  );
  const rows = await index.select(
    "SELECT ?s ?p ?o ?missing { GRAPH ?g { ?s ?p ?o OPTIONAL { ?s <https://example/missing> ?missing } } } ORDER BY ?p",
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]?.get("s")?.equals(rows[1]?.get("s"))).toBe(true);
  expect(rows[0]?.get("missing")).toBeUndefined();
  expect(rows[1]?.get("s")?.equals(rows[1]?.get("o"))).toBe(true);
  const before = await index.construct("CONSTRUCT { ?s ?p ?o } { GRAPH ?g { ?s ?p ?o } }");
  await index.restore(await index.snapshot());
  expect(
    await engine.canonicalize(
      await index.construct("CONSTRUCT { ?s ?p ?o } { GRAPH ?g { ?s ?p ?o } }"),
    ),
  ).toBe(await engine.canonicalize(before));
});

test("LocalIndex restores existing gzip/fromCompressed and zstd snapshots", async () => {
  const { zstdCompressSync } = await import("node:zlib");
  const { SparqStore } = await import("@sparq-org/sparq");
  const { gunzipSync } = await import("node:zlib");
  const index = await engine.createIndex();
  const text = '<https://example/s> <https://example/p> "café" <https://example/g> .';
  const zstd = new Uint8Array(zstdCompressSync(text));
  await index.restore(zstd);
  expect(index.list()).toEqual(["https://example/g"]);
  expect(index.size()).toBe(1);
  const snapshot = await index.snapshot();
  expect(gunzipSync(snapshot).toString()).toContain('"café"');
  const compatible = await SparqStore.fromCompressed(snapshot, "nquads", { dataset: true });
  try {
    expect(compatible.countQuads()).toBe(1);
  } finally {
    compatible.free();
  }
  const skippable = new Uint8Array(8 + zstd.length);
  skippable.set([0x50, 0x2a, 0x4d, 0x18, 0, 0, 0, 0]);
  skippable.set(zstd, 8);
  await index.restore(skippable);
  expect(index.size()).toBe(1);
  await expect(index.restore(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]))).rejects.toThrow();
  expect(index.size()).toBe(1);
});

test("LocalIndex rejects malformed and mismatched query forms without changing the store", async () => {
  const index = await engine.createIndex();
  await expect(index.select("invalid SPARQL")).rejects.toThrow();
  await expect(index.ask("SELECT * {}")).rejects.toThrow();
  await expect(index.construct("SELECT * {}")).rejects.toThrow();
  await expect(index.select("ASK {}")).rejects.toThrow("SELECT");
  await expect(
    index.select("INSERT DATA { <https://example/s> <https://example/p> 1 }"),
  ).rejects.toThrow();
  expect(index.size()).toBe(0);
  expect(await index.select("SELECT * { GRAPH ?g { ?s ?p ?o } }")).toEqual([]);
  const empty = await index.selectStream("SELECT * { GRAPH ?g { ?s ?p ?o } }");
  expect(await empty.next()).toEqual({ done: true, value: undefined });
});

test.each(["\n", "\r\n", "\r"])("SELECT accepts comments terminated by %j", async (ending) => {
  const index = await engine.createIndex();
  const query = `# comment${ending}SELECT * {}`;
  expect(await index.select(query)).toHaveLength(1);
  const rows = [];
  for await (const row of await index.selectStream(query)) rows.push(row);
  expect(rows).toEqual(await index.select(query));
});

test.each([
  "\n",
  "\r\n",
  "\r",
])("SELECT accepts prologue comments terminated by %j and rejects malformed declarations", async (ending) => {
  const index = await engine.createIndex();
  const query =
    "# comment\n bAse # base\n <https://example/#base>\n PREFIX # prefix\n ex: # iri\n <https://example/#>\n select ?x { VALUES ?x { ex:s } }".replaceAll(
      "\n",
      ending,
    );
  expect((await index.select(query))[0]?.get("x")?.value).toBe("https://example/#s");
  const stream = await index.selectStream(query);
  expect((await stream.next()).value?.get("x")?.value).toBe("https://example/#s");
  stream.dispose();
  for (const invalid of [
    "PREFIX invalid SELECT * {}",
    "PREFIX ex: invalid SELECT * {}",
    "BASE invalid SELECT * {}",
  ])
    await expect(index.selectStream(invalid)).rejects.toThrow("SELECT");
});

test.each([
  "empty",
  "populated",
])("LocalIndex synchronizes %s graph membership on put, replacement and remove", async (kind) => {
  const index = await engine.createIndex();
  const data = await engine.parse("<urn:s> <urn:p> <urn:o> .", "text/turtle");
  const ask = "ASK { GRAPH <urn:g> {} }";
  const query = "SELECT ?g { GRAPH ?g {} }";
  await index.put("urn:g", kind === "empty" ? [] : data);
  expect(index.has("urn:g")).toBe(true);
  expect(await index.ask(ask)).toBe(true);
  expect((await index.select(query)).map((row) => row.get("g")?.value)).toEqual(index.list());
  await index.put("urn:g", []);
  expect(index.size()).toBe(0);
  expect(index.has("urn:g")).toBe(true);
  expect(await index.ask(ask)).toBe(true);
  await index.remove("urn:g");
  expect(index.has("urn:g")).toBe(false);
  expect(await index.ask(ask)).toBe(false);
  expect(await index.select(query)).toEqual([]);
  await index.remove("urn:g");
  await index.put("urn:g", data);
  expect(await index.ask(ask)).toBe(true);
  expect(index.size()).toBe(1);
});

test.each([
  1, 2,
])("restore rebuilds graph membership and applies the %i-quad cap", async (maxQuads) => {
  const source = await engine.createIndex();
  const data = await engine.parse("<urn:s> <urn:p> <urn:o> .", "text/turtle");
  await source.put("urn:shared", data);
  await source.put("urn:new", data);
  const index = await engine.createIndex({ maxQuads });
  await index.put("urn:stale", data);
  await index.put("urn:empty", []);
  await index.put("urn:shared", []);
  await index.restore(await source.snapshot());
  const expected = maxQuads === 1 ? ["urn:new"] : ["urn:new", "urn:shared"];
  expect(index.list().sort()).toEqual(expected);
  expect(index.size()).toBe(maxQuads);
  expect(
    (await index.select("SELECT ?g { GRAPH ?g {} }")).map((row) => row.get("g")?.value).sort(),
  ).toEqual(expected);
  for (const graph of ["urn:stale", "urn:empty", "urn:shared", "urn:new"]) {
    expect(await index.ask(`ASK { GRAPH <${graph}> {} }`)).toBe(index.has(graph));
  }
  expect(await index.select("SELECT * { GRAPH ?g { ?s ?p ?o } }")).toHaveLength(maxQuads);
  const empty = await engine.createIndex();
  await index.restore(await empty.snapshot());
  expect(index.list()).toEqual([]);
  expect(index.size()).toBe(0);
  expect(await index.ask("ASK { GRAPH ?g {} }")).toBe(false);
});

test("eviction and removal delete actual WASM graph quads, including blank nodes", async () => {
  const index = await engine.createIndex({ maxQuads: 1 });
  const data = await engine.parse("_:a <https://example/p> _:a .", "text/turtle");
  await index.put("https://example/empty", []);
  await index.put("https://example/a", data);
  expect(await index.ask("ASK { GRAPH <https://example/a> { ?s ?p ?o } }")).toBe(true);
  await index.put("https://example/b", data);
  expect(index.has("https://example/empty")).toBe(false);
  expect(index.has("https://example/a")).toBe(false);
  expect(await index.ask("ASK { GRAPH <https://example/empty> {} }")).toBe(false);
  expect(await index.ask("ASK { GRAPH <https://example/a> {} }")).toBe(false);
  expect(await index.ask("ASK { GRAPH <https://example/b> {} }")).toBe(true);
  expect(await index.ask("ASK { GRAPH <https://example/a> { ?s ?p ?o } }")).toBe(false);
  expect(await index.select("SELECT * { GRAPH ?g { ?s ?p ?o } }")).toHaveLength(1);
  await index.remove("https://example/b");
  expect(await index.ask("ASK { GRAPH ?g {} }")).toBe(false);
  expect(await index.ask("ASK { GRAPH ?g { ?s ?p ?o } }")).toBe(false);
});
