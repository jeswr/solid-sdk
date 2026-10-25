// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Store } from "n3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRdfEngine } from "./node.js";
import { createFakeRdfEngine } from "./testing.js";
import type { RdfEngine, RdfMediaType } from "./types.js";

const triple = '<https://example/s> <https://example/p> "café\\n\\"text\\""@fr .\n';
const named = "<https://example/a> <https://example/p> <https://example/o> <https://example/g> .\n";
const sources: [RdfMediaType, string][] = [
  ["text/turtle", triple],
  ["application/n-triples", triple],
  [
    "application/trig",
    `${triple}<https://example/g> { <https://example/a> <https://example/p> <https://example/o> }`,
  ],
  ["application/n-quads", triple + named],
];

for (const [name, factory] of [
  ["fake", createFakeRdfEngine],
  ["real Node wasm", createRdfEngine],
] as const) {
  describe(name, () => {
    let engine: RdfEngine;
    beforeEach(() => {
      engine = factory();
    });
    afterEach(() => {
      engine.dispose();
    });

    test("initializes lazily and idempotently", async () => {
      expect(engine.loaded).toBe(false);
      expect(engine.features).toBeNull();
      await Promise.all([engine.ready(), engine.ready()]);
      expect(engine.loaded).toBe(true);
    });

    test.each(
      sources,
    )("parses and serializes %s with string and UTF-8 input", async (format, text) => {
      const parsed = await engine.parse(text, format);
      const bytes = await engine.parse(new TextEncoder().encode(text), format);
      const expected =
        format === "application/trig" || format === "application/n-quads" ? named + triple : triple;
      expect(await engine.canonicalize(parsed)).toBe(expected);
      expect(await engine.canonicalize(bytes)).toBe(expected);
      const output = await engine.serialize(parsed, format);
      expect(await engine.canonicalize(await engine.parse(output, format))).toBe(expected);
      expect([...parsed.match(null, null, null, null)]).toHaveLength(parsed.size);
    });

    test("resolves document bases without losing TriG named graphs", async () => {
      for (const format of ["text/turtle", "application/trig"] as const) {
        const body = "<s> <p> <o> .";
        const input = format === "application/trig" ? `<g> { ${body} }` : body;
        const data = await engine.parse(input, format, { baseIri: "https://example/" });
        expect([...data][0]?.subject.value).toBe("https://example/s");
        expect([...data][0]?.graph.value).toBe(
          format === "application/trig" ? "https://example/g" : "",
        );
      }
    });

    test.each(
      sources.map(([format]) => format),
    )("scopes labelled blank nodes to each parsed %s document", async (format) => {
      const input = "_:s <https://example/p> _:s .";
      const first = await engine.parse(input, format);
      const second = await engine.parse(input, format);
      const union = new Store([...first, ...second]);
      expect(union.size).toBe(2);
      expect(new Set([...union].map((quad) => quad.subject.value)).size).toBe(2);
      for (const quad of union) {
        expect(quad.subject.termType).toBe("BlankNode");
        expect(quad.subject.equals(quad.object)).toBe(true);
      }
    });

    test.each([
      ["application/trig", "_:s <p> _:o . _:s { _:o <p> _:s . }"],
      ["application/n-quads", "_:s <https://example/p> _:o .\n_:o <https://example/p> _:s _:s ."],
    ] as const)("preserves blank-node links across graph scopes in %s", async (format, input) => {
      const first = await engine.parse(input, format, { baseIri: "https://example/" });
      const second = await engine.parse(input, format, { baseIri: "https://example/" });
      expect(new Store([...first, ...second]).size).toBe(4);
      for (const data of [first, second]) {
        const defaultQuad = [...data].find((quad) => quad.graph.termType === "DefaultGraph");
        const namedQuad = [...data].find((quad) => quad.graph.termType === "BlankNode");
        expect(defaultQuad?.subject.equals(namedQuad?.object)).toBe(true);
        expect(defaultQuad?.object.equals(namedQuad?.subject)).toBe(true);
        expect(defaultQuad?.subject.equals(namedQuad?.graph)).toBe(true);
        expect(defaultQuad?.subject.equals(defaultQuad?.object)).toBe(false);
      }
    });

    test("canonicalizes ground data as sorted, deduplicated N-Quads", async () => {
      const data = await engine.parse(triple + named, "application/n-quads");
      expect(await engine.canonicalize([...data, ...data].reverse())).toBe(named + triple);
      expect(await engine.canonicalize([])).toBe("");
    });

    test("canonical N-Quads use canonical escapes and Unicode codepoint ordering", async () => {
      const input =
        '<https://example/😀> <https://example/p> "😀\\u000b\\u001f\\u007f\\\\U0001f600" .\n' +
        '<https://example/\uF900> <https://example/p> "bmp" .\n';
      const expected =
        '<https://example/\uF900> <https://example/p> "bmp" .\n' +
        '<https://example/😀> <https://example/p> "😀\\u000B\\u001F\\u007F\\\\U0001f600" .\n';
      expect(await engine.canonicalize(await engine.parse(input, "application/n-quads"))).toBe(
        expected,
      );
    });

    test("writes prefixes and empty documents", async () => {
      const data = await engine.parse(triple, "text/turtle");
      const output = await engine.serialize(data, "text/turtle", {
        prefixes: { ex: "https://example/" },
        pretty: false,
      });
      expect(output).toContain("ex:");
      expect(await engine.canonicalize(await engine.parse(output, "text/turtle"))).toBe(triple);
      for (const [format] of sources) {
        expect((await engine.parse(await engine.serialize([], format), format)).size).toBe(0);
      }
    });

    test("rejects malformed documents, invalid UTF-8 and unknown media types", async () => {
      await expect(engine.parse("broken RDF", "text/turtle")).rejects.toThrow();
      await expect(engine.parse(new Uint8Array([0xff]), "text/turtle")).rejects.toThrow();
      await expect(engine.parse("", "unknown" as RdfMediaType)).rejects.toThrow(
        "Unsupported RDF media type",
      );
      await expect(engine.serialize([], "unknown" as RdfMediaType)).rejects.toThrow(
        "Unsupported RDF media type",
      );
    });

    test("disposal is idempotent and terminal; returned datasets remain owned by the caller", async () => {
      const data = await engine.parse(triple, "text/turtle");
      engine.dispose();
      engine.dispose();
      expect(data.size).toBe(1);
      expect(engine.loaded).toBe(false);
      await expect(engine.ready()).rejects.toThrow("disposed");
      await expect(engine.parse(triple, "text/turtle")).rejects.toThrow("disposed");
      await expect(engine.serialize([], "text/turtle")).rejects.toThrow("disposed");
      await expect(engine.validate([], "")).rejects.toThrow("disposed");
      await expect(engine.canonicalize([])).rejects.toThrow("disposed");
      await expect(engine.createIndex()).rejects.toThrow("disposed");
    });

    test("LocalIndex replaces/removes resource graphs, deduplicates and owns its data", async () => {
      const index = await engine.createIndex();
      const data = await engine.parse(triple + named, "application/n-quads");
      expect(index.size()).toBe(0);
      expect(index.has("https://example/resource")).toBe(false);
      await index.put("https://example/resource", [...data, ...data]);
      expect(index.has("https://example/resource")).toBe(true);
      expect(index.size()).toBe(2);
      for (const quad of data) {
        data.delete(quad);
        break;
      }
      expect(index.size()).toBe(2);
      await index.put("https://example/resource", data);
      expect(index.size()).toBe(1);
      await index.put("https://example/second", data);
      expect(index.size()).toBe(2);
      await expect(index.put("relative-graph", data)).rejects.toThrow();
      expect(index.size()).toBe(2);
      await index.remove("https://example/resource");
      await index.remove("https://example/resource");
      expect(index.has("https://example/resource")).toBe(false);
      expect(index.has("https://example/second")).toBe(true);
      expect(index.size()).toBe(1);
      await index.put("https://example/second", []);
      expect(index.has("https://example/second")).toBe(true);
      expect(index.size()).toBe(0);
      index.dispose();
      index.dispose();
      expect(() => index.size()).toThrow("disposed");
      expect(() => index.has("https://example/second")).toThrow("disposed");
      await expect(index.put("https://example/second", [])).rejects.toThrow("disposed");
      await expect(index.remove("https://example/second")).rejects.toThrow("disposed");
    });

    test("engine disposal also disposes all owned indexes", async () => {
      const first = await engine.createIndex();
      const second = await engine.createIndex();
      engine.dispose();
      expect(() => first.size()).toThrow("disposed");
      expect(() => second.size()).toThrow("disposed");
    });

    test("disposal cancels an operation queued after initialization", async () => {
      await engine.ready();
      const parsing = engine.parse(triple, "text/turtle");
      engine.dispose();
      await expect(parsing).rejects.toThrow("disposed");
    });
  });
}
