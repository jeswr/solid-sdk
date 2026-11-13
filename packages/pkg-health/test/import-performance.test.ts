// AUTHORED-BY Codex GPT-6
import { Store } from "n3";
import { expect, it, vi } from "vitest";
import { importHealthExport, projectHealthFacts } from "../src/index.js";
import { syntheticHealthExport, syntheticOwner } from "./support/synthetic-export.js";

it("imports and projects 600 nanopubs without reinserting parsed quads", async () => {
  const text = await syntheticHealthExport(600);
  const add = Store.prototype.addQuad;
  let insertions = 0;
  const spy = vi.spyOn(Store.prototype, "addQuad").mockImplementation(function (
    this: Store,
    ...args
  ) {
    insertions++;
    return Reflect.apply(add, this, args);
  });
  try {
    const { value, skipped } = await importHealthExport(text, { owner: syntheticOwner });
    const view = projectHealthFacts(value, { owner: syntheticOwner });
    expect(skipped.count).toBe(0);
    expect(value.nanopubs).toHaveLength(600);
    expect(view.facts).toHaveLength(600);
    expect(view.sources).toHaveLength(80);
    // Parsing inserts once. Metadata reads, tolerant retention, classification,
    // provenance and health projection must insert no further copies.
    expect(insertions).toBe(value.dataset.size);
  } finally {
    spy.mockRestore();
  }
}, 30_000);
