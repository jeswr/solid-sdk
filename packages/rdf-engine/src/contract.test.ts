// AUTHORED-BY Codex GPT-6.1-Sol
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
    });

    test("disposal cancels an operation queued after initialization", async () => {
      await engine.ready();
      const parsing = engine.parse(triple, "text/turtle");
      engine.dispose();
      await expect(parsing).rejects.toThrow("disposed");
    });
  });
}
