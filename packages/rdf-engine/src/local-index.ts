// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { Quad } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { codec, gunzip, gzip } from "./compression.js";
import { parseN3, writeN3 } from "./rdf.js";
import { resultStream } from "./result-stream.js";
import type { Bindings, IndexOptions, LocalIndex, ResultStream } from "./types.js";

export interface IndexBackend {
  delta(inserts: Quad[], deletes: Quad[], creates: string[], drops: string[]): void;
  release(): void;
  select: LocalIndex["select"];
  selectStream: LocalIndex["selectStream"];
  ask: LocalIndex["ask"];
  construct: LocalIndex["construct"];
  decodeZstd(bytes: Uint8Array): Promise<string>;
}

/** Shared lifecycle, codec, ordered mutations and graph-level eviction for real and fake engines. */
export async function createLocalIndex(
  backend: IndexBackend,
  opts: IndexOptions = {},
  own: (index: LocalIndex) => void = () => {},
): Promise<LocalIndex> {
  const maxQuads = opts.maxQuads ?? 2_000_000;
  const graphs = new Map<string, Quad[]>();
  const streams = new Set<ResultStream<Bindings>>();
  let disposed = false;
  let size = 0;
  let tail = Promise.resolve();
  function check() {
    if (disposed) throw new Error("LocalIndex is disposed");
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(() => {
      check();
      return operation();
    });
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  function touch(graph: string) {
    const data = graphs.get(graph);
    if (data) {
      graphs.delete(graph);
      graphs.set(graph, data);
    }
  }
  function quads() {
    return [...graphs.values()].flat();
  }
  async function snapshot() {
    const bytes = await gzip(writeN3(quads(), "application/n-quads"));
    check();
    return bytes;
  }
  async function save() {
    if (opts.persist) {
      await opts.persist.save(await snapshot());
      check();
    }
  }
  function replace(next: Map<string, Quad[]>) {
    let count = [...next.values()].reduce((sum, data) => sum + data.length, 0);
    for (const [iri, data] of next) {
      if (count <= maxQuads) break;
      next.delete(iri);
      count -= data.length;
    }
    const inserts: Quad[] = [];
    const deletes: Quad[] = [];
    for (const [iri, data] of graphs)
      if (next.get(iri) !== data) for (const quad of data) deletes.push(quad);
    for (const [iri, data] of next)
      if (graphs.get(iri) !== data) for (const quad of data) inserts.push(quad);
    backend.delta(
      inserts,
      deletes,
      [...next.keys()].filter((iri) => !graphs.has(iri)),
      [...graphs.keys()].filter((iri) => !next.has(iri)),
    );
    graphs.clear();
    for (const [iri, data] of next) graphs.set(iri, data);
    size = count;
  }
  async function restore(bytes: Uint8Array) {
    const text = codec(bytes) === "gzip" ? await gunzip(bytes) : await backend.decodeZstd(bytes);
    check();
    const next = new Map<string, Quad[]>();
    for (const q of parseN3(text, "application/n-quads")) {
      if (q.graph.termType !== "NamedNode")
        throw new TypeError("Snapshot requires named resource graphs");
      new URL(q.graph.value);
      let data = next.get(q.graph.value);
      if (!data) {
        data = [];
        next.set(q.graph.value, data);
      }
      data.push(q);
    }
    replace(next);
  }
  const index: LocalIndex = {
    async put(graphIri, source) {
      check();
      new URL(graphIri);
      const graph = DataFactory.namedNode(graphIri);
      const data = [
        ...new Store(
          [...source].map((q) => DataFactory.quad(q.subject, q.predicate, q.object, graph)),
        ),
      ];
      if (data.length > maxQuads) throw new RangeError("Graph exceeds LocalIndex maxQuads");
      return enqueue(async () => {
        const next = new Map(graphs);
        next.delete(graphIri);
        next.set(graphIri, data);
        replace(next);
        await save();
      });
    },
    remove(graphIri) {
      return enqueue(async () => {
        const previous = graphs.get(graphIri) ?? [];
        backend.delta([], previous, [], graphs.has(graphIri) ? [graphIri] : []);
        graphs.delete(graphIri);
        size -= previous.length;
        await save();
      });
    },
    has(graphIri) {
      check();
      touch(graphIri);
      return graphs.has(graphIri);
    },
    size() {
      check();
      return size;
    },
    list() {
      check();
      return [...graphs.keys()];
    },
    select(sparql) {
      return enqueue(() => backend.select(sparql));
    },
    selectStream(sparql) {
      return enqueue(async () => {
        const source = await backend.selectStream(sparql);
        if (disposed) {
          source.dispose();
          check();
        }
        const stream = resultStream(
          () => source.next(),
          () => {
            source.dispose();
            streams.delete(stream);
          },
        );
        streams.add(stream);
        return stream;
      });
    },
    ask(sparql) {
      return enqueue(() => backend.ask(sparql));
    },
    construct(sparql) {
      return enqueue(() => backend.construct(sparql));
    },
    snapshot() {
      return enqueue(snapshot);
    },
    restore(bytes) {
      const copy = new Uint8Array(bytes);
      return enqueue(async () => {
        await restore(copy);
        await save();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      graphs.clear();
      size = 0;
      for (const stream of streams) stream.dispose();
      backend.release();
    },
  };
  own(index);
  try {
    if (!Number.isSafeInteger(maxQuads) || maxQuads < 0)
      throw new RangeError("Invalid LocalIndex maxQuads");
    const bytes = await opts.persist?.load();
    check();
    if (bytes) await restore(bytes);
    return index;
  } catch (error) {
    index.dispose();
    throw error;
  }
}
