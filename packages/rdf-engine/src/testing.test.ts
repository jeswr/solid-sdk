// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import { createFakeRdfEngine, FakeEngineUnsupportedError } from "./testing.js";

test("fake imports no Sparq module and rejects unsupported operations with a typed error", async () => {
  vi.doMock("@sparq-org/sparq", () => {
    throw new Error("WASM must not load");
  });
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
  vi.doUnmock("@sparq-org/sparq");
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
