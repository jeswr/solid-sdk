// AUTHORED-BY Codex GPT-6
import { Parser, Store } from "n3";
import { afterEach, expect, test, vi } from "vitest";
import { createEngine } from "./engine.js";
import { createRdfEngine } from "./node.js";
import { createFakeRdfEngine, FakeEngineUnsupportedError } from "./testing.js";
import type { FormOptions } from "./types.js";

const focus = "https://example/alice";
const shape = "https://example/shape";
const data = new Store(new Parser().parse(`<${focus}> <https://example/name> "Alice" .`));
const shapes = new Store(
  new Parser().parse(`
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  <${shape}> a sh:NodeShape ; sh:targetNode <${focus}> ;
    sh:property <https://example/name-shape> .
  <https://example/name-shape> sh:path <https://example/name> ; sh:name "Name" .
`),
);
afterEach(() => vi.restoreAllMocks());

test.each([
  "edit",
  "view",
] as const)("passes %s options and returns the native FormDescription unchanged", async (mode) => {
  const runtime = await import("@sparq-org/sparq/wasm-node");
  const derive = vi.spyOn(runtime.Store.prototype, "deriveForm");
  const free = vi.spyOn(runtime.Store.prototype, "free");
  const engine = createRdfEngine();
  const opts: FormOptions = { mode, shape };
  try {
    const result = await engine.deriveForm(data, shapes, focus, opts);
    expect(derive).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('"Alice"'),
      expect.stringContaining("http://www.w3.org/ns/shacl#NodeShape"),
      focus,
      "nquads",
      JSON.stringify(opts),
    );
    expect(result).toEqual(JSON.parse(derive.mock.results[0]?.value as string));
    expect(result).toMatchObject({
      mode,
      focus: { kind: "iri", value: focus },
      groups: [
        {
          fields: [
            { label: "Name", editable: mode === "edit", values: [{ term: { value: "Alice" } }] },
          ],
        },
      ],
    });
    expect(free).toHaveBeenCalledTimes(1);
  } finally {
    engine.dispose();
  }
  await expect(engine.deriveForm(data, shapes, focus, opts)).rejects.toThrow("disposed");
});

test("supports automatic shape selection with mode only", async () => {
  const engine = createRdfEngine();
  try {
    expect(await engine.deriveForm(data, shapes, focus, { mode: "edit" })).toMatchObject({
      shape: { value: shape },
    });
  } finally {
    engine.dispose();
  }
});

test("frees stores on native errors and malformed JSON responses", async () => {
  const runtime = await import("@sparq-org/sparq/wasm-node");
  const free = vi.spyOn(runtime.Store.prototype, "free");
  const engine = createRdfEngine();
  try {
    // Exercise a real WASM error before testing a malformed binding response.
    await expect(
      engine.deriveForm(data, shapes, focus, { mode: "invalid" as "edit" }),
    ).rejects.toThrow();
    expect(free).toHaveBeenCalledTimes(1);
    vi.spyOn(runtime.Store.prototype, "deriveForm").mockReturnValue("invalid JSON");
    await expect(engine.deriveForm(data, shapes, focus, { mode: "edit" })).rejects.toThrow(
      SyntaxError,
    );
    expect(free).toHaveBeenCalledTimes(2);
  } finally {
    engine.dispose();
  }
});

test("missing forms feature fails descriptively and frees the receiver", async () => {
  const runtime = await import("@sparq-org/sparq/wasm-node");
  vi.spyOn(runtime.Store.prototype, "deriveForm").mockImplementation(undefined as never);
  Object.defineProperty(runtime.Store.prototype, "deriveForm", {
    configurable: true,
    value: undefined,
  });
  const free = vi.spyOn(runtime.Store.prototype, "free");
  const engine = createEngine(async () => runtime);
  try {
    await expect(engine.deriveForm(data, shapes, focus, { mode: "edit" })).rejects.toThrow(
      "lacks deriveForm",
    );
    expect(free).toHaveBeenCalledTimes(1);
  } finally {
    engine.dispose();
  }
});

test("fake form derivation is explicitly unsupported and obeys disposal", async () => {
  const engine = createFakeRdfEngine();
  await expect(engine.deriveForm(data, shapes, focus, { mode: "edit" })).rejects.toBeInstanceOf(
    FakeEngineUnsupportedError,
  );
  engine.dispose();
  await expect(engine.deriveForm(data, shapes, focus, { mode: "edit" })).rejects.toThrow(
    "disposed",
  );
});
