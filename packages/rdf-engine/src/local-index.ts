// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import type { LocalIndex } from "./types.js";

/** Shared graph lifecycle; the real engine mirrors each delta into its owned WASM store. */
export function createLocalIndex(
  delta: (inserts: Quad[], deletes: Quad[]) => void,
  release: () => void,
): LocalIndex {
  const graphs = new Map<string, Quad[]>();
  let disposed = false;
  let size = 0;
  function check() {
    if (disposed) throw new Error("LocalIndex is disposed");
  }
  return {
    async put(graphIri, data) {
      check();
      // Reject relative graph names before mutating either implementation.
      new URL(graphIri);
      const graph = DataFactory.namedNode(graphIri);
      const next = [
        ...new Store(
          [...data].map((q) => DataFactory.quad(q.subject, q.predicate, q.object, graph)),
        ),
      ];
      const previous = graphs.get(graphIri) ?? [];
      delta(next, previous);
      graphs.set(graphIri, next);
      size += next.length - previous.length;
    },
    async remove(graphIri) {
      check();
      const previous = graphs.get(graphIri) ?? [];
      delta([], previous);
      graphs.delete(graphIri);
      size -= previous.length;
    },
    has(graphIri) {
      check();
      return graphs.has(graphIri);
    },
    size() {
      check();
      return size;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      graphs.clear();
      size = 0;
      release();
    },
  };
}
