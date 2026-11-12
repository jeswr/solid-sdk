// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import type { Term } from "@rdfjs/types";
import { DataFactory as df, Store } from "n3";
import { expect, it, vi } from "vitest";
import { parseNanopublications, readNamedGraph } from "../src/index.js";

it("intersects graph snapshots without copying indexes or exposing another graph", async () => {
  const value = await parseNanopublications(
    await readFile(new URL("./fixtures/synthetic.expected.trig", import.meta.url), "utf8"),
  );
  const np = value.nanopubs[0];
  if (!np) throw new Error("Missing fictional nanopub");
  const view = readNamedGraph(value.dataset, np.assertionId);
  const expected = value.dataset.getQuads(null, null, null, np.assertionId);
  const q = expected[0];
  const outside = value.dataset.getQuads(null, null, null, np.id)[0];
  if (!q || !outside) throw new Error("Missing fictional graph");
  const insert = vi.spyOn(Store.prototype, "addQuad");
  try {
    expect([...view]).toEqual(expected);
    expect(view.size).toBe(expected.length);
    expect([...view.match()]).toEqual(expected);
    expect([...view.match(null, null, null, null)]).toEqual(expected);
    const selected = view.match(q.subject, q.predicate, q.object, q.graph);
    expect(selected.size).toBe(1);
    expect([...selected.match(q.subject, q.predicate, q.object, q.graph)]).toEqual([q]);
    expect([...selected.match()]).toEqual([q]);
    expect(view.has(q)).toBe(true);
    expect(view.has(outside)).toBe(false);
    expect(selected.has(q)).toBe(true);
    const terms: Term[] = [q.subject, q.predicate, q.object, q.graph];
    for (let i = 0; i < 4; i++) {
      const wrong = [...terms];
      wrong[i] = df.namedNode("https://example.org/absent");
      const empty = selected.match(...wrong);
      expect(empty.size).toBe(0);
      expect([...empty]).toEqual([]);
      expect(empty.has(q)).toBe(false);
      expect([...empty.match()]).toEqual([]);
    }
    expect([...view.match(null, null, null, df.defaultGraph())]).toEqual([]);
    expect([...view.match(df.namedNode("https://example.org/absent"))]).toEqual([]);
    expect([...view.match(null, df.namedNode("https://example.org/absent"))]).toEqual([]);
    expect([...view.match(null, null, df.literal("Fictional absent"))]).toEqual([]);
    expect(() => view.add(q)).toThrow("Read-only graph view");
    expect(() => view.delete(q)).toThrow("Read-only graph view");
    expect(value.dataset.has(q)).toBe(true);
    // Snapshots retain the old graph; a new read observes backing-store edits.
    value.dataset.delete(q);
    expect(view.size).toBe(expected.length);
    expect(view.has(q)).toBe(true);
    expect([...selected]).toEqual([q]);
    expect(selected.has(q)).toBe(true);
    expect(readNamedGraph(value.dataset, np.assertionId).has(q)).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  } finally {
    insert.mockRestore();
  }
});
