// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { expect, test, vi } from "vitest";
import { createEngine } from "./engine.js";

test("all document stores return owned heapBytes to baseline on success and failure", async () => {
  const runtime = await import("@sparq-org/sparq/wasm-node");
  const { Store } = runtime;
  const live = new Set<InstanceType<typeof Store>>();
  const heapBytes = () => [...live].reduce((sum, store) => sum + store.heapBytes(), 0);
  let peak = 0;
  let created = 0;
  let freed = 0;
  const free = Store.prototype.free;
  const factories = ["load", "loadDataset", "loadWithBase"] as const;
  for (const key of factories) {
    const original = Store[key];
    vi.spyOn(Store, key).mockImplementation((...args: [string, string, string?]) => {
      const store = Reflect.apply(original, Store, args);
      live.add(store);
      created++;
      peak = Math.max(peak, heapBytes());
      return store;
    });
  }
  vi.spyOn(Store.prototype, "free").mockImplementation(function (this: InstanceType<typeof Store>) {
    expect(live.delete(this)).toBe(true);
    freed++;
    free.call(this);
  });
  const engine = createEngine(async () => runtime);
  const before = heapBytes();
  try {
    for (let iteration = 0; iteration < 100; iteration++) {
      const data = await engine.parse('<s> <p> "value" .', "text/turtle", {
        baseIri: "https://example/",
      });
      await engine.parse('<https://example/s> <https://example/p> "value" .', "text/turtle");
      await engine.serialize(data, "application/trig");
      await engine.validate(data, "");
      await engine.canonicalize(data);
      await expect(engine.validate(data, "invalid shapes")).rejects.toThrow();
      const index = await engine.createIndex();
      await index.put("https://example/resource", data);
      expect(live.size).toBe(1);
      const owned = [...live][0];
      expect(
        owned?.ask(
          'ASK { GRAPH <https://example/resource> { <https://example/s> <https://example/p> "value" } }',
        ),
      ).toBe(true);
      await index.remove("https://example/resource");
      expect(owned?.ask("ASK { GRAPH <https://example/resource> { ?s ?p ?o } }")).toBe(false);
      index.dispose();
      expect(heapBytes()).toBe(before);
    }
    // Failure after allocation during parse/materialization and serialization must free too.
    const query = vi.spyOn(Store.prototype, "query").mockImplementation(() => {
      throw new Error("query failed");
    });
    await expect(engine.parse("", "text/turtle")).rejects.toThrow("query failed");
    query.mockRestore();
    for (const input of [
      "<https://example/s> <https://example/p> <<( <https://example/a> <https://example/b> <https://example/c> )>> .",
      '<https://example/s> <https://example/p> "v"@en--ltr .',
    ]) {
      await expect(engine.parse(input, "text/turtle")).rejects.toThrow("Unsupported RDF");
      expect(live.size).toBe(0);
      expect(heapBytes()).toBe(before);
    }
    await engine.parse(
      '{"@context":null,"@id":"#me","https://example/p":"value"}',
      "application/ld+json",
      { baseIri: "https://example/profile" },
    );
    expect(live.size).toBe(0);
    expect(heapBytes()).toBe(before);
    const serialize = vi.spyOn(Store.prototype, "serialize").mockImplementation(() => {
      throw new Error("writer failed");
    });
    await expect(engine.serialize([], "text/turtle")).rejects.toThrow("writer failed");
    serialize.mockRestore();
    await expect(engine.parse("invalid RDF", "text/turtle")).rejects.toThrow();
    expect(peak).toBeGreaterThan(0);
    expect(created).toBeGreaterThanOrEqual(600);
    expect(freed).toBe(created);
    expect(live.size).toBe(0);
    expect(heapBytes()).toBe(before);
  } finally {
    engine.dispose();
    vi.restoreAllMocks();
    for (const store of live) store.free();
  }
});
