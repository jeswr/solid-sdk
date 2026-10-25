// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createEngine, type Runtime } from "./engine.js";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("shares initialization across engines and paths while preserving the first engine's index", async () => {
  const { createRdfEngine } = await import("./index.js");
  const bytes = await readFile(
    new URL(import.meta.resolve("@sparq-org/sparq/wasm/sparq_wasm_bg.wasm")),
  );
  const response = () => new Response(bytes, { headers: { "Content-Type": "application/wasm" } });
  let completeSecond = (_response: Response) => {};
  const secondResponse = new Promise<Response>((resolve) => {
    completeSecond = resolve;
  });
  const fetch = vi.fn().mockResolvedValueOnce(response()).mockReturnValue(secondResponse);
  vi.stubGlobal("fetch", fetch);
  const loader = vi.fn(() => import("@sparq-org/sparq"));
  const first = createRdfEngine({
    wasmUrl: new URL("https://app.example/wasm/test.wasm"),
    loader,
  });
  const second = createRdfEngine({ wasmUrl: "https://app.example/wasm/other.wasm", loader });
  const defaultLoader = vi.fn(() => import("@sparq-org/sparq"));
  const defaultEngine = createRdfEngine({ loader: defaultLoader });
  expect(loader).not.toHaveBeenCalled();
  const firstReady = first.ready();
  const secondReady = second.ready();
  await firstReady;
  const data = await first.parse(
    '<https://example/s> <https://example/p> "value" .',
    "text/turtle",
  );
  const runtime = await import("@sparq-org/sparq/wasm/sparq_wasm.js");
  const loads = vi.spyOn(runtime.Store, "loadDataset");
  const index = await first.createIndex();
  const owned = loads.mock.results[0]?.value as InstanceType<typeof runtime.Store>;
  try {
    await index.put("https://example/resource", data);
    // A competing URL initialization must not replace the WASM memory behind this store.
    completeSecond(response());
    await secondReady;
    expect(loader).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(new URL("https://app.example/wasm/test.wasm"));
    expect(first.features).toEqual({ serialize: true, parseShaclCompact: true });
    await defaultEngine.ready();
    expect(defaultLoader).not.toHaveBeenCalled();
    const query =
      'ASK { GRAPH <https://example/resource> { <https://example/s> <https://example/p> "value" } }';
    expect(owned.ask(query)).toBe(true);
    await index.remove("https://example/resource");
    expect(owned.ask(query)).toBe(false);
    await index.put("https://example/resource", data);
    first.dispose();
    second.dispose();
    defaultEngine.dispose();
    // Successful initialization is retained even after every engine is disposed.
    const later = createRdfEngine({ loader: defaultLoader });
    await later.ready();
    expect(defaultLoader).not.toHaveBeenCalled();
    later.dispose();
  } finally {
    first.dispose();
    second.dispose();
    defaultEngine.dispose();
  }
});

test("default initialization works with the installed web module in Node", async () => {
  const { createRdfEngine } = await import("./index.js");
  const fetch = vi.fn().mockRejectedValue(new Error("unexpected WASM fetch"));
  vi.stubGlobal("fetch", fetch);
  const loader = vi.fn(() => import("@sparq-org/sparq"));
  const engine = createRdfEngine({ loader });
  const secondLoader = vi.fn(() => import("@sparq-org/sparq"));
  const second = createRdfEngine({
    wasmUrl: "https://unused.example/test.wasm",
    loader: secondLoader,
  });
  await Promise.all([engine.ready(), second.ready()]);
  expect(engine.loaded).toBe(true);
  expect(second.loaded).toBe(true);
  expect(loader).toHaveBeenCalledTimes(1);
  expect(secondLoader).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  engine.dispose();
  second.dispose();
});

test("shared initialization can retry on another engine after loading fails", async () => {
  const { createRdfEngine } = await import("./index.js");
  const loader = vi.fn().mockRejectedValueOnce(new Error("load failed"));
  const first = createRdfEngine({ loader });
  const second = createRdfEngine({ loader });
  const results = await Promise.allSettled([first.ready(), second.ready()]);
  expect(results).toEqual([
    { status: "rejected", reason: new Error("load failed") },
    { status: "rejected", reason: new Error("load failed") },
  ]);
  expect(loader).toHaveBeenCalledTimes(1);
  expect(first.loaded).toBe(false);
  expect(second.loaded).toBe(false);
  const engine = createRdfEngine();
  await engine.ready();
  expect(engine.loaded).toBe(true);
  await first.ready();
  expect(first.loaded).toBe(true);
  expect(loader).toHaveBeenCalledTimes(1);
  first.dispose();
  second.dispose();
  engine.dispose();
});

test("failed loading can retry", async () => {
  const runtime = await import("@sparq-org/sparq/wasm-node");
  const load = vi
    .fn<() => Promise<Runtime>>()
    .mockRejectedValueOnce(new Error("load failed"))
    .mockResolvedValue(runtime);
  const engine = createEngine(load);
  await expect(engine.ready()).rejects.toThrow("load failed");
  expect(engine.loaded).toBe(false);
  await engine.ready();
  expect(engine.loaded).toBe(true);
  expect(load).toHaveBeenCalledTimes(2);
  engine.dispose();
});

test("disposing during loading cannot resurrect an engine or start an operation", async () => {
  let complete: (runtime: Runtime) => void = () => {
    throw new Error("not initialized");
  };
  const pending = new Promise<Runtime>((resolve) => {
    complete = resolve;
  });
  const engine = createEngine(() => pending);
  const parsing = engine.parse("", "text/turtle");
  engine.dispose();
  complete(await import("@sparq-org/sparq/wasm-node"));
  await expect(parsing).rejects.toThrow("disposed");
  expect(engine.loaded).toBe(false);
});

test("feature detection describes a missing optional serializer and always frees its store", async () => {
  const runtime = await import("@sparq-org/sparq/wasm-node");
  const descriptor = Object.getOwnPropertyDescriptor(runtime.Store.prototype, "serialize");
  const compact = Object.getOwnPropertyDescriptor(runtime.Store.prototype, "parseShaclCompact");
  const free = vi.spyOn(runtime.Store.prototype, "free");
  Object.defineProperty(runtime.Store.prototype, "serialize", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(runtime.Store.prototype, "parseShaclCompact", {
    configurable: true,
    value: undefined,
  });
  const engine = createEngine(async () => runtime);
  try {
    await engine.ready();
    expect(engine.features).toEqual({ serialize: false, parseShaclCompact: false });
    await expect(engine.serialize([], "text/turtle")).rejects.toThrow("lacks serialize");
    expect(free).toHaveBeenCalledTimes(1);
  } finally {
    if (descriptor) Object.defineProperty(runtime.Store.prototype, "serialize", descriptor);
    if (compact) Object.defineProperty(runtime.Store.prototype, "parseShaclCompact", compact);
    engine.dispose();
  }
});
