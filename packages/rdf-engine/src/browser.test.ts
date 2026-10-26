import { expect, test, vi } from "vitest";
import { createRdfEngine } from "./browser.js";
import type { IndexOptions } from "./types.js";

const { createIndex, createBase } = vi.hoisted(() => ({
  createIndex: vi.fn(),
  createBase: vi.fn(),
}));
vi.mock("./index.js", () => ({ createRdfEngine: createBase }));

test("browser indexes default to IndexedDB and preserve explicit persistence and memory settings", async () => {
  createBase.mockReturnValue({ createIndex });
  const engine = createRdfEngine({ wasmUrl: "https://example/engine.wasm" });
  expect(createBase).toHaveBeenCalledWith({ wasmUrl: "https://example/engine.wasm" });
  await engine.createIndex();
  const defaults = createIndex.mock.calls[0]?.[0] as IndexOptions;
  expect(defaults.persist?.load).toBeTypeOf("function");
  expect(defaults.persist?.save).toBeTypeOf("function");
  const persist = {
    async load() {
      return null;
    },
    async save() {},
  };
  await engine.createIndex({ persist, maxQuads: 10 });
  expect(createIndex).toHaveBeenLastCalledWith({ persist, maxQuads: 10 });
  createRdfEngine();
  expect(createBase).toHaveBeenLastCalledWith({});
});
