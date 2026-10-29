// AUTHORED-BY Codex GPT-6.1-Sol
import { JsonLdParser } from "jsonld-streaming-parser";
import { DataFactory, Parser, Store, Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RDF_QUADS,
  parseBoundedRdf,
  RdfLimitError,
  serializeBoundedTurtle,
} from "../src/bounded-rdf.js";

const BASE = "https://alice.example/pod/data";
const N3_STRUCTURES = [
  ["blank nodes", (depth: number) => `${"[ <urn:p> ".repeat(depth)}"leaf"${"]".repeat(depth)}`],
  ["collections", (depth: number) => `${"(".repeat(depth)}"leaf"${")".repeat(depth)}`],
  [
    "reified triples",
    (depth: number) => `${"<< ".repeat(depth)}<urn:s>${" <urn:p> <urn:o> >>".repeat(depth)}`,
  ],
  [
    "triple terms",
    (depth: number) => `${"<<( <urn:s> <urn:p> ".repeat(depth)}<urn:o>${")>>".repeat(depth)}`,
  ],
] as const;
afterEach(() => vi.restoreAllMocks());

describe.each([
  "text/turtle",
  "application/x-turtle",
  "application/trig",
  "application/n-triples",
  "application/n-quads",
])("bounded %s parsing", (format) => {
  it.each([
    "é",
    "中",
    "🌱",
  ])("preserves statements before an EOF comment ending in %s", async (tail) => {
    const statement = '<urn:s> <urn:p> "café 🌱". # ';
    // Cover one chunk and a multibyte character split at the 4096-byte boundary.
    for (const padding of ["", " ".repeat(4095 - Buffer.byteLength(statement))]) {
      const dataset = await parseBoundedRdf(statement + padding + tail, format, BASE);
      expect(dataset.size).toBe(1);
      expect(dataset.getQuads("urn:s", "urn:p", null, null)[0]?.object.value).toBe("café 🌱");
    }
  });

  it("rejects malformed input ending in a non-ASCII byte", async () => {
    await expect(parseBoundedRdf('<urn:s> <urn:p> "x". é', format, BASE)).rejects.toThrow();
  });

  it.each([
    '?s <urn:p> "x".',
    '<urn:s> ?p "x".',
    "<urn:s> <urn:p> ?o.",
    "<urn:s> = <urn:o>.",
    "<urn:s> => <urn:o>.",
    "<urn:s> <= <urn:o>.",
  ])("rejects N3 extensions: %s", async (source) => {
    await expect(parseBoundedRdf(source, format, BASE)).rejects.toThrow();
  });
});

describe.each([
  "text/turtle",
  "application/x-turtle",
  "application/trig",
])("bounded %s structure", (format) => {
  it.each(
    N3_STRUCTURES,
  )("limits pending %s before generating nodes or quads", async (_kind, value) => {
    const source = `<urn:s> <urn:p> ${value(2_000)} .`;
    expect(Buffer.byteLength(source)).toBeLessThan(1024 * 1024);
    const saveContext = vi.spyOn(
      Parser.prototype as unknown as Record<"_saveContext", (...args: unknown[]) => void>,
      "_saveContext",
    );
    const blankNode = vi.spyOn(DataFactory, "blankNode");
    const addQuad = vi.spyOn(Store.prototype, "addQuad");
    await expect(parseBoundedRdf(source, format, BASE)).rejects.toBeInstanceOf(RdfLimitError);
    expect(saveContext.mock.calls.length).toBeLessThanOrEqual(64);
    expect(blankNode.mock.calls.length).toBeLessThanOrEqual(64);
    expect(addQuad).not.toHaveBeenCalled();
  });

  it.each(
    N3_STRUCTURES,
  )("accepts 64 levels of %s and rejects the next level", async (_kind, value) => {
    const source = (depth: number) => `<urn:s> <urn:p> ${value(depth)} .`;
    expect((await parseBoundedRdf(source(64), format, BASE)).size).toBeGreaterThan(0);
    await expect(parseBoundedRdf(source(65), format, BASE)).rejects.toBeInstanceOf(RdfLimitError);
  });

  it("charges repeated sibling contexts before the quad limit", async () => {
    const statement = "<urn:s> <urn:p> [] .\n";
    expect((await parseBoundedRdf(statement.repeat(100), format, BASE)).size).toBe(100);
    const blankNode = vi.spyOn(DataFactory, "blankNode");
    const addQuad = vi.spyOn(Store.prototype, "addQuad");
    await expect(parseBoundedRdf(statement.repeat(20_000), format, BASE)).rejects.toBeInstanceOf(
      RdfLimitError,
    );
    expect(blankNode.mock.calls.length).toBeLessThan(16_384);
    expect(addQuad.mock.calls.length).toBeLessThan(16_384);
  });

  it("shares generated list-node allocations with directive work", async () => {
    const base = `${BASE}/${"long".repeat(64)}/`;
    const directives = "@base <> .\n".repeat(9);
    const list = `<urn:s> <urn:p> (${'"" '.repeat(3_500)}) .`;
    expect((await parseBoundedRdf(directives, format, base)).size).toBe(0);
    expect((await parseBoundedRdf(list, format, base)).size).toBe(7_001);
    await expect(parseBoundedRdf(directives + list, format, base)).rejects.toBeInstanceOf(
      RdfLimitError,
    );
  });

  it("treats structural characters in literals, IRIs and comments as data", async () => {
    const value = "[(){}<< >> <<( )>> {| |}]".repeat(100);
    const iri = `urn:${"()".repeat(100)}`;
    const dataset = await parseBoundedRdf(`<${iri}> <urn:p> "${value}" . # ${value}`, format, BASE);
    expect(dataset.getQuads(iri, "urn:p", null, null)[0]?.object.value).toBe(value);
  });
});

describe("JSON-LD scalar literals", () => {
  it.each([
    [true, "boolean", "true"],
    [false, "boolean", "false"],
    [0, "integer", "0"],
    [42, "integer", "42"],
    [-42, "integer", "-42"],
    [12.5, "double", "1.25E1"],
    [-12.5, "double", "-1.25E1"],
    [1e21, "double", "1.0E21"],
    [-1e21, "double", "-1.0E21"],
    [1e-7, "double", "1.0E-7"],
    [0, "double", "0.0E0"],
    [42, "double", "4.2E1"],
    [1.2345678901234567, "double", "1.234567890123457E0"],
    [1000000000000000100, "integer", "1000000000000000128"],
    [12.5, "decimal", "1.25E1"],
    [1e21, "integer", "1.0E21"],
    ["001", "integer", "001"],
    ["12.5", "double", "12.5"],
    ["1e+21", "double", "1e+21"],
    ["café 🌱", "string", "café 🌱"],
  ])("converts typed %s to xsd:%s with lexical value %s", async (value, type, lexical) => {
    const datatype = `http://www.w3.org/2001/XMLSchema#${type}`;
    const dataset = await parseBoundedRdf(
      JSON.stringify({ "@id": "urn:s", "urn:p": { "@value": value, "@type": datatype } }),
      "application/ld+json",
      BASE,
    );
    expect(dataset.size).toBe(1);
    expect(dataset.getQuads("urn:s", "urn:p", null, null)[0]?.object).toMatchObject({
      termType: "Literal",
      value: lexical,
      language: "",
      datatype: { value: datatype },
    });
  });

  it.each([
    [12.5, "double"],
    [1e21, "double"],
    [-1e21, "double"],
    [-1e22, "double"],
    [1e-7, "double"],
    [42, "integer"],
    [1000000000000000100, "integer"],
    [-1000000000000000100, "integer"],
  ])("gives implicit and explicit %s the same RDF term", async (value, type) => {
    const dataset = await parseBoundedRdf(
      JSON.stringify({
        "@id": "urn:s",
        "urn:implicit": value,
        "urn:explicit": { "@value": value, "@type": `http://www.w3.org/2001/XMLSchema#${type}` },
      }),
      "application/ld+json",
      BASE,
    );
    expect(dataset.size).toBe(2);
    const implicit = dataset.getQuads("urn:s", "urn:implicit", null, null)[0]?.object;
    const explicit = dataset.getQuads("urn:s", "urn:explicit", null, null)[0]?.object;
    expect(explicit?.equals(implicit)).toBe(true);
  });

  it.each([
    [1000000000000000100, "integer", "1000000000000000128"],
    [-1000000000000000100, "integer", "-1000000000000000128"],
    [-1e21, "double", "-1.0E21"],
    [-1e22, "double", "-1.0E22"],
    [0, "double", "0.0E0"],
    [42, "double", "4.2E1"],
    [12.5, "decimal", "1.25E1"],
    [-1e21, "integer", "-1.0E21"],
    [-1e21, "decimal", "-1.0E21"],
    ["001", "integer", "001"],
    ["-1e21", "double", "-1e21"],
  ])("preserves context-coerced JSON-LD scalar %s as xsd:%s %s", async (value, type, lexical) => {
    const datatype = `http://www.w3.org/2001/XMLSchema#${type}`;
    const dataset = await parseBoundedRdf(
      JSON.stringify({
        "@context": { p: { "@id": "urn:p", "@type": datatype } },
        "@id": "urn:s",
        p: [value],
      }),
      "application/ld+json",
      BASE,
    );
    expect(dataset.size).toBe(1);
    expect(dataset.getQuads("urn:s", "urn:p", null, null)[0]?.object).toMatchObject({
      termType: "Literal",
      value: lexical,
      datatype: { value: datatype },
    });
  });

  it("normalizes JSON-LD scalar numbers in untyped value objects, lists and scoped contexts", async () => {
    const dataset = await parseBoundedRdf(
      JSON.stringify({
        "@context": {
          value: "@value",
          nested: {
            "@id": "urn:nested",
            "@context": {
              p: { "@id": "urn:p", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
            },
          },
        },
        "@id": "urn:s",
        "urn:value": { value: -1e21 },
        "urn:list": { "@list": [-1e21, 1000000000000000100] },
        nested: { "@id": "urn:n", p: 1000000000000000100 },
      }),
      "application/ld+json",
      BASE,
    );
    const literals = [...dataset]
      .map((quad) => quad.object)
      .filter((term) => term.termType === "Literal");
    expect(literals).toHaveLength(4);
    expect(literals.map((term) => term.value).sort()).toEqual([
      "-1.0E21",
      "-1.0E21",
      "1000000000000000128",
      "1000000000000000128",
    ]);
    expect(dataset.getQuads("urn:s", "urn:value", null, null)[0]?.object).toMatchObject({
      datatype: { value: "http://www.w3.org/2001/XMLSchema#double" },
    });
  });
});

describe.each(["1e400", "-1e400"])("non-finite JSON-LD numbers (%s)", (number) => {
  it.each([
    ["implicit", `{"urn:p":${number}}`],
    ["untyped value", `{"urn:p":{"@value":${number}}}`],
    [
      "typed value",
      `{"urn:p":{"@value":${number},"@type":"http://www.w3.org/2001/XMLSchema#double"}}`,
    ],
    [
      "coerced value",
      `{"@context":{"p":{"@id":"urn:p","@type":"http://www.w3.org/2001/XMLSchema#double"}},"p":${number}}`,
    ],
    ["JSON scalar", `{"urn:p":{"@value":${number},"@type":"@json"}}`],
    ["nested JSON", `{"urn:p":{"@value":{"nested":[${number}]},"@type":"@json"}}`],
    [
      "coerced JSON",
      `{"@context":{"p":{"@id":"urn:p","@type":"@json"}},"p":{"nested":[${number}]}}`,
    ],
    [
      "aliased JSON",
      `{"@context":{"v":"@value","t":"@type"},"urn:p":{"v":[${number}],"t":"@json"}}`,
    ],
    ["ignored property", `{"ignored":[${number}]}`],
  ])("rejects %s before streaming instead of substituting null", async (_kind, source) => {
    const transform = vi.spyOn(JsonLdParser.prototype, "_transform");
    await expect(parseBoundedRdf(source, "application/ld+json", BASE)).rejects.toThrow(
      "Non-finite JSON numbers are unsupported.",
    );
    expect(transform).not.toHaveBeenCalled();
  });
});

it("preserves finite JSON-LD numbers, lexical strings and null in opaque JSON", async () => {
  const value = {
    numbers: [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, 0],
    strings: ["1e400", "-1e400"],
    absent: null,
  };
  const dataset = await parseBoundedRdf(
    JSON.stringify({ "@id": "urn:s", "urn:p": { "@value": value, "@type": "@json" } }),
    "application/ld+json",
    BASE,
  );
  expect(dataset.size).toBe(1);
  expect(
    JSON.parse(dataset.getQuads("urn:s", "urn:p", null, null)[0]?.object.value ?? "null"),
  ).toEqual(value);
});

describe("RDF expansion and serialization budgets", () => {
  it.each([
    ["TriG graphs", "application/trig", "{ <urn:s> <urn:p> ", " . }"],
    ["annotations", "text/turtle", "<urn:s> <urn:p> <urn:o> {| <urn:a> ", " |} ."],
  ])("counts %s alongside nested collections", async (_kind, format, open, close) => {
    const source = (depth: number) =>
      `${open}${"(".repeat(depth)}"leaf"${")".repeat(depth)}${close}`;
    expect((await parseBoundedRdf(source(63), format, BASE)).size).toBeGreaterThan(0);
    await expect(parseBoundedRdf(source(64), format, BASE)).rejects.toBeInstanceOf(RdfLimitError);
  });

  it("bounds repeated empty TriG graphs without RDF terms or quads", async () => {
    expect((await parseBoundedRdf("{}\n".repeat(100), "application/trig", BASE)).size).toBe(0);
    const addQuad = vi.spyOn(Store.prototype, "addQuad");
    await expect(
      parseBoundedRdf("{}\n".repeat(20_000), "application/trig", BASE),
    ).rejects.toBeInstanceOf(RdfLimitError);
    expect(addQuad).not.toHaveBeenCalled();
  });

  it.each([
    ["objects", '{"unmapped":', "}", 10_000],
    ["arrays", "[", "]", 10_000],
    ["mixed containers", '{"unmapped":[', "]}", 100],
    [
      "JSON literals",
      `{"urn:p":{"@type":"@json","@value":${"[".repeat(100)}`,
      `${"]".repeat(100)}}}`,
      1,
    ],
  ] as const)("rejects excessive JSON-LD depth in %s before streaming", async (_kind, open, close, depth) => {
    // Build text directly: stringify itself can overflow on attacker nesting.
    const source = `${open.repeat(depth)}null${close.repeat(depth)}`;
    expect(Buffer.byteLength(source)).toBeLessThan(1024 * 1024);
    const transform = vi.spyOn(JsonLdParser.prototype, "_transform");
    await expect(parseBoundedRdf(source, "application/ld+json", BASE)).rejects.toBeInstanceOf(
      RdfLimitError,
    );
    expect(transform).not.toHaveBeenCalled();
  });

  it.each([
    ["wide", "[", "]", 100_000],
    ["depth-weighted", `${'{"unmapped":'.repeat(30)}[`, `]${"}".repeat(30)}`, 2_000],
  ] as const)("bounds %s JSON-LD jobs even without RDF terms", async (_kind, open, close, count) => {
    const source = `${open}${"{},".repeat(count - 1)}{}${close}`;
    expect(Buffer.byteLength(source)).toBeLessThan(1024 * 1024);
    const transform = vi.spyOn(JsonLdParser.prototype, "_transform");
    await expect(parseBoundedRdf(source, "application/ld+json", BASE)).rejects.toBeInstanceOf(
      RdfLimitError,
    );
    expect(transform).not.toHaveBeenCalled();
  });

  it("accepts bounded nesting and treats structural characters in strings as data", async () => {
    expect(
      (await parseBoundedRdf(`${"[".repeat(64)}null${"]".repeat(64)}`, "application/ld+json", BASE))
        .size,
    ).toBe(0);
    await expect(
      parseBoundedRdf(`${"[".repeat(65)}null${"]".repeat(65)}`, "application/ld+json", BASE),
    ).rejects.toBeInstanceOf(RdfLimitError);
    const literal = '[{"\\'.repeat(100);
    const dataset = await parseBoundedRdf(
      JSON.stringify({ "@id": "urn:s", "urn:p": literal }),
      "application/ld+json",
      BASE,
    );
    expect(dataset.getQuads("urn:s", "urn:p", null, null)[0]?.object.value).toBe(literal);
  });

  it("bounds chained prefix expansion before emitting quads", async () => {
    const context = {
      p0: `https://example.org/${"long".repeat(4096)}/`,
      ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i + 1}`, `p${i}:x/`])),
    };
    await expect(
      parseBoundedRdf(JSON.stringify({ "@context": context }), "application/ld+json", BASE),
    ).rejects.toBeInstanceOf(RdfLimitError);
  });

  it("preserves inherited prefixes in small scoped inline contexts", async () => {
    const dataset = await parseBoundedRdf(
      JSON.stringify({
        "@context": [
          { p: "https://example.org/" },
          { nested: { "@id": "p:nested", "@context": { name: "p:name" } } },
        ],
        "@id": "urn:s",
        nested: { name: "Alice" },
      }),
      "application/ld+json",
      BASE,
    );
    expect(dataset.size).toBe(2);
    expect(dataset.getQuads(null, "https://example.org/name", null, null)[0]?.object.value).toBe(
      "Alice",
    );
  });

  it.each([
    "prefix",
    "vocab",
    "array",
    "scoped",
  ])("bounds inline %s context expansion without emitted quads", async (kind) => {
    const iri = `https://example.org/${"long".repeat(4096)}/`;
    const terms = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, "p:x"]));
    const context =
      kind === "vocab"
        ? { "@vocab": iri, ...Object.fromEntries(Object.keys(terms).map((key) => [key, {}])) }
        : kind === "array"
          ? [{ p: iri }, terms]
          : kind === "scoped"
            ? { nested: { "@id": "urn:nested", "@context": { p: iri, ...terms } } }
            : { p: iri, ...terms };
    const source = JSON.stringify({ "@context": context });
    expect(Buffer.byteLength(source)).toBeLessThan(1024 * 1024);
    const addQuad = vi.spyOn(Store.prototype, "addQuad");
    await expect(parseBoundedRdf(source, "application/ld+json", BASE)).rejects.toBeInstanceOf(
      RdfLimitError,
    );
    expect(addQuad).not.toHaveBeenCalled();
  });

  it("shares the context allocation budget with RDF term creation", async () => {
    const iri = `https://example.org/${"long".repeat(4096)}/`;
    const context = {
      p: iri,
      ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, "p:x"])),
    };
    const graph = Array.from({ length: 45 }, (_, i) => ({ "@id": `urn:s${i}`, "p:name": "a" }));
    const source = (value: unknown) => JSON.stringify(value);
    expect(
      (await parseBoundedRdf(source({ "@context": context }), "application/ld+json", BASE)).size,
    ).toBe(0);
    expect(
      (
        await parseBoundedRdf(
          source({ "@context": { p: iri }, "@graph": graph }),
          "application/ld+json",
          BASE,
        )
      ).size,
    ).toBe(45);
    await expect(
      parseBoundedRdf(
        source({ "@context": context, "@graph": graph }),
        "application/ld+json",
        BASE,
      ),
    ).rejects.toBeInstanceOf(RdfLimitError);
  });

  it("bounds expanded prefix declarations even without emitted quads", async () => {
    const base = `${BASE}/${"long".repeat(4096)}`;
    const source = Array.from({ length: 100 }, (_, i) => `@prefix p${i}: <#${i}>.`).join("\n");
    const addQuad = vi.spyOn(Store.prototype, "addQuad");
    await expect(parseBoundedRdf(source, "text/turtle", base)).rejects.toBeInstanceOf(
      RdfLimitError,
    );
    expect(addQuad).not.toHaveBeenCalled();
  });

  it.each([
    "text/turtle",
    "application/x-turtle",
    "application/trig",
  ])("bounds chained relative base directives without quads in %s", async (format) => {
    const source = "@base <segment/> .\n".repeat(4096);
    expect(Buffer.byteLength(source)).toBeLessThan(1024 * 1024);
    const addQuad = vi.spyOn(Store.prototype, "addQuad");
    await expect(parseBoundedRdf(source, format, BASE)).rejects.toBeInstanceOf(RdfLimitError);
    expect(addQuad).not.toHaveBeenCalled();
  });

  it.each([
    "@base <> .\n",
    "BASE <>\n",
    "BaSe <>\n",
  ])("charges repeated base resolution against an expanded base (%s)", async (directive) => {
    const base = `${BASE}/${"long".repeat(64)}/`;
    expect((await parseBoundedRdf(directive, "text/turtle", base)).size).toBe(0);
    await expect(
      parseBoundedRdf(directive.repeat(100), "text/turtle", base),
    ).rejects.toBeInstanceOf(RdfLimitError);
  });

  it("shares directive work with the expanded term budget", async () => {
    const base = `${BASE}/${"long".repeat(64)}/`;
    const directives = "@base <> .\n".repeat(8);
    const statements = '<s> <p> "Alice" .\n'.repeat(800);
    expect((await parseBoundedRdf(directives, "text/turtle", base)).size).toBe(0);
    expect((await parseBoundedRdf(statements, "text/turtle", base)).size).toBe(1);
    await expect(
      parseBoundedRdf(directives + statements, "text/turtle", base),
    ).rejects.toBeInstanceOf(RdfLimitError);
  });

  it.each([
    "initial",
    "directive",
  ])("bounds a single expensive %s base before normalization", async (kind) => {
    const base = `${BASE}/${"long".repeat(1024)}/`;
    const source = kind === "initial" ? "" : `BASE <${base}>`;
    const addQuad = vi.spyOn(Store.prototype, "addQuad");
    await expect(
      parseBoundedRdf(source, "text/turtle", kind === "initial" ? base : BASE),
    ).rejects.toBeInstanceOf(RdfLimitError);
    expect(addQuad).not.toHaveBeenCalled();
  });

  it("preserves ordinary relative base and prefix resolution", async () => {
    const dataset = await parseBoundedRdf(
      '@base <https://example.org/> . BASE <nested/> PREFIX p: <vocab/> <s> p:name "Alice" .',
      "text/turtle",
      BASE,
    );
    expect(
      dataset.getQuads(
        "https://example.org/nested/s",
        "https://example.org/nested/vocab/name",
        null,
        null,
      )[0]?.object.value,
    ).toBe("Alice");
  });

  it.each([
    "text/turtle",
    "application/ld+json",
  ])("bounds duplicate %s quads before Store insertion", async (contentType) => {
    const count = MAX_RDF_QUADS + 1;
    const source =
      contentType === "text/turtle"
        ? "<urn:s> <urn:p> <urn:o>.\n".repeat(count)
        : `{"@id":"urn:s","urn:p":[${'{"@id":"urn:o"},'.repeat(count - 1)}{"@id":"urn:o"}]}`;
    expect(Buffer.byteLength(source)).toBeLessThan(1024 * 1024);
    const withinLimit =
      contentType === "text/turtle"
        ? "<urn:s> <urn:p> <urn:o>.\n".repeat(MAX_RDF_QUADS)
        : `{"@id":"urn:s","urn:p":[${'{"@id":"urn:o"},'.repeat(MAX_RDF_QUADS - 1)}{"@id":"urn:o"}]}`;
    expect((await parseBoundedRdf(withinLimit, contentType, BASE)).size).toBe(1);
    const addQuad = vi.spyOn(Store.prototype, "addQuad");
    await expect(parseBoundedRdf(source, contentType, BASE)).rejects.toBeInstanceOf(RdfLimitError);
    expect(addQuad.mock.calls.length).toBeLessThanOrEqual(MAX_RDF_QUADS);
  });

  it("stops the writer before later quads when escaping exceeds the output budget", async () => {
    const dataset = await parseBoundedRdf(
      `<urn:s> <urn:p> "${"🌱".repeat(150_000)}". <urn:last> <urn:p> "tail".`,
      "text/turtle",
      BASE,
    );
    expect(dataset.size).toBe(2);
    const addQuad = vi.spyOn(Writer.prototype, "addQuad");
    expect(() => serializeBoundedTurtle(dataset)).toThrow(RdfLimitError);
    expect(addQuad).toHaveBeenCalledTimes(1);
  });

  it("retains valid empty Turtle", async () => {
    expect(serializeBoundedTurtle(await parseBoundedRdf("", "text/turtle", BASE))).toBe("");
  });
});
