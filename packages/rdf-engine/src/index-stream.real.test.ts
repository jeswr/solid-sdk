
import * as runtime from "@sparq-org/sparq/wasm-node";
import { afterEach, expect, test, vi } from "vitest";
import { createRdfEngine } from "./node.js";

const engine = createRdfEngine();
afterEach(() => {
  vi.restoreAllMocks();
});
const query = "SELECT * { GRAPH ?g { ?s ?p ?o } }";

test("cursors free on full consumption, break, return, explicit disposal and index/engine disposal", async () => {
  const free = vi.spyOn(runtime.SolutionCursor.prototype, "free");
  const stores = vi.spyOn(runtime.Store.prototype, "free");
  const data = await engine.parse('<https://example/s> <https://example/p> "x" .', "text/turtle");
  const index = await engine.createIndex();
  await index.put("https://example/g", data);
  free.mockClear();
  stores.mockClear();
  for await (const _row of await index.selectStream(query)) {
    /* drain */
  }
  expect(free).toHaveBeenCalledTimes(1);
  for await (const _row of await index.selectStream(query)) break;
  expect(free).toHaveBeenCalledTimes(2);
  const unstarted = await index.selectStream(query);
  unstarted.dispose();
  unstarted.dispose();
  expect(free).toHaveBeenCalledTimes(3);
  expect(await unstarted.next()).toEqual({ done: true, value: undefined });
  const returned = await index.selectStream(query);
  await returned.return?.();
  expect(free).toHaveBeenCalledTimes(4);
  const owned = await index.selectStream(query);
  index.dispose();
  expect(free).toHaveBeenCalledTimes(5);
  expect(stores).toHaveBeenCalledTimes(1);
  expect(await owned.next()).toEqual({ done: true, value: undefined });
  const other = await engine.createIndex();
  await other.selectStream(query);
  engine.dispose();
  expect(free).toHaveBeenCalledTimes(6);
  expect(stores).toHaveBeenCalledTimes(2);
});

test("cursor errors and unsupported term conversion free the cursor exactly once", async () => {
  const local = createRdfEngine();
  const free = vi.spyOn(runtime.SolutionCursor.prototype, "free");
  try {
    const index = await local.createIndex();
    await expect(index.selectStream("invalid")).rejects.toThrow();
    const failed = await index.selectStream(query);
    const next = vi.spyOn(runtime.SolutionCursor.prototype, "next").mockImplementationOnce(() => {
      throw new Error("cursor failed");
    });
    await expect(failed.next()).rejects.toThrow("cursor failed");
    expect(free).toHaveBeenCalledTimes(1);
    next.mockRestore();
    await expect(index.selectStream("ASK {}")).rejects.toThrow("SELECT");
    const malformed = await index.selectStream(query);
    vi.spyOn(runtime.SolutionCursor.prototype, "next").mockReturnValueOnce(
      JSON.stringify({ boolean: true }),
    );
    await expect(malformed.next()).rejects.toThrow("SELECT");
    expect(free).toHaveBeenCalledTimes(2);
    const data = await local.parse('<https://example/s> <https://example/p> "x" .', "text/turtle");
    await index.put("https://example/g", data);
    vi.spyOn(runtime.SolutionCursor.prototype, "next").mockReturnValueOnce(
      JSON.stringify({ results: { bindings: [{ o: { type: "triple", value: "x" } }] } }),
    );
    const unsupported = await index.selectStream(query);
    await expect(unsupported.next()).rejects.toThrow("Unsupported RDF query term");
    expect(free).toHaveBeenCalledTimes(3);
    local.dispose();
    expect(free).toHaveBeenCalledTimes(3);
  } finally {
    local.dispose();
  }
});
