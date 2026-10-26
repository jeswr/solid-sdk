// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import { createFakeRdfEngine, FakeEngineUnsupportedError } from "./testing.js";

vi.mock("@sparq-org/sparq", () => {
  throw new Error("WASM must not load");
});
vi.mock("@sparq-org/sparq/wasm-node", () => {
  throw new Error("Node WASM must not load");
});
vi.mock("@sparq-org/sparq/wasm/sparq_wasm.js", () => {
  throw new Error("Web WASM must not load");
});

test("fake imports no Sparq module and rejects unsupported operations with a typed error", async () => {
  const fake = createFakeRdfEngine();
  await expect(fake.parse("{}", "application/ld+json")).rejects.toBeInstanceOf(
    FakeEngineUnsupportedError,
  );
  await expect(fake.serialize([], "application/ld+json")).rejects.toBeInstanceOf(
    FakeEngineUnsupportedError,
  );
  for (const input of [
    '_:s <https://example/p> "o" .',
    "<https://example/s> <https://example/p> _:o .",
    '<https://example/s> <https://example/p> "o" _:g .',
  ]) {
    const data = await fake.parse(input, "application/n-quads");
    await expect(fake.canonicalize(data)).rejects.toMatchObject({
      name: "FakeEngineUnsupportedError",
      operation: "blank-node canonicalization",
    });
  }
  fake.dispose();
});

test("fake validation defaults to conforming and accepts a result or async validator", async () => {
  const defaultEngine = createFakeRdfEngine();
  expect(await defaultEngine.validate([], "")).toEqual({ conforms: true, results: [] });
  const report = { conforms: false, results: [] };
  const configured = createFakeRdfEngine({ validate: report });
  expect(await configured.validate([], "")).toBe(report);
  const validate = vi.fn(async () => report);
  const callback = createFakeRdfEngine({ validate });
  const data: [] = [];
  expect(await callback.validate(data, "shapes")).toBe(report);
  expect(validate).toHaveBeenCalledWith(data, "shapes");
  for (const engine of [defaultEngine, configured, callback]) engine.dispose();
});

test("fake index query methods are explicitly unsupported without handlers, as is zstd", async () => {
  const fake = createFakeRdfEngine();
  try {
    const index = await fake.createIndex();
    for (const operation of ["select", "selectStream", "ask", "construct"] as const) {
      await expect(index[operation]("query")).rejects.toBeInstanceOf(FakeEngineUnsupportedError);
    }
    await expect(index.restore(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]))).rejects.toBeInstanceOf(
      FakeEngineUnsupportedError,
    );
  } finally {
    fake.dispose();
  }
});

test("fake index accepts injected query methods and streams SELECT rows without WASM", async () => {
  const select = vi.fn(async () => []);
  const ask = vi.fn(async () => true);
  const construct = vi.fn(async () => []);
  const fake = createFakeRdfEngine({ query: { select, ask, construct } });
  try {
    const index = await fake.createIndex();
    expect(await index.select("select")).toEqual([]);
    expect(await index.ask("ask")).toBe(true);
    expect(await index.construct("construct")).toEqual([]);
    const stream = await index.selectStream("stream");
    expect(await stream.next()).toEqual({ done: true, value: undefined });
    expect(select.mock.calls).toEqual([["select"], ["stream"]]);
    expect(ask).toHaveBeenCalledWith("ask");
    expect(construct).toHaveBeenCalledWith("construct");
  } finally {
    fake.dispose();
  }
  const { resultStream } = await import("./result-stream.js");
  const release = vi.fn();
  const injected = resultStream<never>(() => ({ done: true, value: undefined }), release);
  const selectStream = vi.fn(async () => injected);
  const other = createFakeRdfEngine({ query: { selectStream } });
  try {
    const stream = await (await other.createIndex()).selectStream("stream");
    other.dispose();
    expect(release).toHaveBeenCalledTimes(1);
    expect(await stream.next()).toEqual({ done: true, value: undefined });
  } finally {
    other.dispose();
  }
});

test("disposing while an injected stream is loading rejects it and releases the late result", async () => {
  const { resultStream } = await import("./result-stream.js");
  const release = vi.fn();
  const source = resultStream<never>(() => ({ done: true, value: undefined }), release);
  let complete: ((stream: typeof source) => void) | undefined;
  const fake = createFakeRdfEngine({
    query: {
      selectStream: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    },
  });
  const index = await fake.createIndex();
  const loading = index.selectStream("query");
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  index.dispose();
  complete?.(source);
  await expect(loading).rejects.toThrow("disposed");
  expect(release).toHaveBeenCalledTimes(1);
  fake.dispose();
});
