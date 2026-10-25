// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { afterEach, expect, test, vi } from "vitest";
import { createEngine, type Runtime } from "./engine.js";
import { createRdfEngine } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("passes a configured wasmUrl to the shipped initializer and shares concurrent loading", async () => {
  const bytes = await readFile(
    new URL(import.meta.resolve("@sparq-org/sparq/wasm/sparq_wasm_bg.wasm")),
  );
  const fetch = vi.fn(
    async () => new Response(bytes, { headers: { "Content-Type": "application/wasm" } }),
  );
  vi.stubGlobal("fetch", fetch);
  const loader = vi.fn(() => import("@sparq-org/sparq"));
  const engine = createRdfEngine({
    wasmUrl: new URL("https://app.example/wasm/test.wasm"),
    loader,
  });
  expect(loader).not.toHaveBeenCalled();
  await Promise.all([engine.ready(), engine.ready()]);
  expect(loader).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(new URL("https://app.example/wasm/test.wasm"));
  expect(engine.features).toEqual({ serialize: true, parseShaclCompact: true });
  expect(
    (await engine.parse('<https://example/s> <https://example/p> "value" .', "text/turtle")).size,
  ).toBe(1);
  engine.dispose();
});

test("default initialization works with the installed web module in Node", async () => {
  const engine = createRdfEngine();
  await engine.ready();
  expect(engine.loaded).toBe(true);
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
