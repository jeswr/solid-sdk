// AUTHORED-BY Codex GPT-6.1-Sol
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

    test("indexes and removes 1000 independent resource graphs", async () => {
      const index = await engine.createIndex();
      const data = await engine.parse(triple, "text/turtle");
      await Promise.all(
        Array.from({ length: 1000 }, (_, i) => index.put(`https://example/${i}`, data)),
      );
      expect(index.size()).toBe(1000);
      expect(index.list()).toHaveLength(1000);
      for (let i = 0; i < 1000; i += 2) await index.remove(`https://example/${i}`);
      expect(index.size()).toBe(500);
      expect(index.list()).toEqual(
        Array.from({ length: 500 }, (_, i) => `https://example/${i * 2 + 1}`),
      );
    });

    test("round-trips single-member gzip N-Quads and replaces previous contents", async () => {
      const index = await engine.createIndex();
      const target = await engine.createIndex();
      const data = await engine.parse(triple + named, "application/n-quads");
      await index.put("https://example/first", data);
      await index.put("https://example/second", data);
      await target.put("https://example/stale", data);
      const bytes = await index.snapshot();
      expect([...bytes.slice(0, 2)]).toEqual([0x1f, 0x8b]);
      await target.restore(bytes);
      expect(target.list()).toEqual(index.list());
      expect(target.size()).toBe(4);
      const unpack = async (input: Uint8Array) =>
        new Response(
          new Blob([input]).stream().pipeThrough(new DecompressionStream("gzip")),
        ).text();
      const expected = await engine.parse(await unpack(bytes), "application/n-quads");
      const actual = await engine.parse(
        await unpack(await target.snapshot()),
        "application/n-quads",
      );
      expect(await engine.canonicalize(actual)).toBe(await engine.canonicalize(expected));
      const empty = await engine.createIndex();
      await target.restore(await empty.snapshot());
      expect(target.size()).toBe(0);
      expect(target.list()).toEqual([]);
    });

    test("evicts least recently used graphs, refreshes has hits and accounts for replacements", async () => {
      const index = await engine.createIndex({ maxQuads: 2 });
      const data = await engine.parse(triple, "text/turtle");
      await index.put("https://example/a", data);
      await index.put("https://example/b", data);
      expect(index.has("https://example/a")).toBe(true);
      expect(index.has("https://example/missing")).toBe(false);
      await index.put("https://example/c", data);
      expect(index.list()).toEqual(["https://example/a", "https://example/c"]);
      expect(index.has("https://example/b")).toBe(false);
      await index.put("https://example/a", data);
      expect(index.list()).toEqual(["https://example/c", "https://example/a"]);
      await index.put("https://example/d", [
        ...data,
        ...(await engine.parse(named, "application/n-quads")),
      ]);
      expect(index.list()).toEqual(["https://example/d"]);
      expect(index.size()).toBe(2);
      await index.put("https://example/d", []);
      expect(index.size()).toBe(0);
      const zero = await engine.createIndex({ maxQuads: 0 });
      await expect(zero.put("https://example/a", data)).rejects.toThrow("maxQuads");
      await zero.put("https://example/empty", []);
      expect(zero.list()).toEqual(["https://example/empty"]);
      for (const maxQuads of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(engine.createIndex({ maxQuads })).rejects.toThrow("maxQuads");
      }
      expect(index.list()).toEqual(["https://example/d"]);
    });

    test("restore enforces the cap and rejects invalid snapshots without replacing data", async () => {
      const index = await engine.createIndex();
      const target = await engine.createIndex({ maxQuads: 1 });
      const data = await engine.parse(triple, "text/turtle");
      await index.put("https://example/a", data);
      await index.put("https://example/b", data);
      await target.restore(await index.snapshot());
      expect(target.list()).toEqual(["https://example/b"]);
      for (const bytes of [
        new Uint8Array(),
        new Uint8Array([1, 2, 3, 4]),
        new Uint8Array([0x1f, 0x8b]),
      ]) {
        await expect(target.restore(bytes)).rejects.toThrow();
        expect(target.size()).toBe(1);
      }
      for (const text of [
        "broken RDF",
        triple,
        '<https://example/s> <https://example/p> "x" _:graph .',
      ]) {
        const bytes = new Uint8Array(
          await new Response(
            new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
          ).arrayBuffer(),
        );
        await expect(target.restore(bytes)).rejects.toThrow();
        expect(target.list()).toEqual(["https://example/b"]);
      }
    });

    test("loads persistence before returning and awaits ordered saves; failed saves can retry", async () => {
      let saved: Uint8Array | null = null;
      let fail = false;
      const persist = {
        async load() {
          return saved;
        },
        async save(bytes: Uint8Array) {
          if (fail) throw new Error("disk full");
          saved = bytes;
        },
      };
      const index = await engine.createIndex({ persist });
      const data = await engine.parse(triple, "text/turtle");
      await Promise.all([
        index.put("https://example/a", data),
        index.put("https://example/b", data),
      ]);
      const loaded = await engine.createIndex({ persist });
      expect(loaded.list()).toEqual(index.list());
      expect(loaded.size()).toBe(2);
      await index.remove("https://example/a");
      const removed = await engine.createIndex({ persist });
      expect(removed.list()).toEqual(["https://example/b"]);
      fail = true;
      await expect(index.put("https://example/c", data)).rejects.toThrow("disk full");
      expect(index.has("https://example/c")).toBe(true);
      fail = false;
      await index.restore(await loaded.snapshot());
      expect((await engine.createIndex({ persist })).list()).toEqual(loaded.list());
      await expect(
        engine.createIndex({
          persist: {
            ...persist,
            async load() {
              throw new Error("load failed");
            },
          },
        }),
      ).rejects.toThrow("load failed");
      await expect(
        engine.createIndex({
          persist: {
            ...persist,
            async load() {
              return new Uint8Array([0]);
            },
          },
        }),
      ).rejects.toThrow("magic");
    });

    test("disposal terminates queued work, streams and pending persistence initialization", async () => {
      const data = await engine.parse(triple, "text/turtle");
      const index = await engine.createIndex();
      const pending = index.put("https://example/a", data);
      index.dispose();
      await expect(pending).rejects.toThrow("disposed");
      expect(() => index.list()).toThrow("disposed");
      await expect(index.snapshot()).rejects.toThrow("disposed");
      await expect(index.restore(new Uint8Array())).rejects.toThrow("disposed");
      await expect(index.select("SELECT * {}")).rejects.toThrow("disposed");
      await expect(index.selectStream("SELECT * {}")).rejects.toThrow("disposed");
      await expect(index.ask("ASK {}")).rejects.toThrow("disposed");
      await expect(index.construct("CONSTRUCT {} {}")).rejects.toThrow("disposed");
      let finish: ((bytes: null) => void) | undefined;
      const loading = engine.createIndex({
        persist: {
          load: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
          async save() {},
        },
      });
      // Wait until the persistence load has actually started, including the real engine's imports.
      while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
      engine.dispose();
      finish(null);
      await expect(loading).rejects.toThrow("disposed");
    });
  });
}
