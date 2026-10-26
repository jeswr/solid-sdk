// AUTHORED-BY Codex GPT-6.1-Sol

import { createLocalIndex } from "./local-index.js";
import { evaluatePolicy } from "./policy.js";
import { decode, formatName, groundCanonical, hasBlankNode, parseN3, writeN3 } from "./rdf.js";
import { resultStream } from "./result-stream.js";
import type { LocalIndex, QuadSource, RdfEngine, ValidationReport } from "./types.js";

export {
  FormGraphUnsupportedError,
  PolicyIdentifierCollisionError,
  PolicySubjectUnsupportedError,
} from "./errors.js";
export type * from "./types.js";

/** A capability intentionally excluded from the small, WASM-free test engine. */
export class FakeEngineUnsupportedError extends Error {
  override readonly name = "FakeEngineUnsupportedError";
  constructor(readonly operation: string) {
    super(`Fake RDF engine does not support ${operation}; use the real engine`);
  }
}

/** Inject query results without evaluating SPARQL or importing Sparq. */
export type FakeQueryHandlers = {
  [K in "select" | "selectStream" | "ask" | "construct"]?: (
    sparql: string,
  ) => Awaited<ReturnType<LocalIndex[K]>> | ReturnType<LocalIndex[K]>;
};

/** Configure validation and query results without implementing SHACL or SPARQL. */
export interface FakeRdfEngineOptions {
  /** Inject query results; omitted methods throw FakeEngineUnsupportedError. */
  query?: FakeQueryHandlers;
  validate?:
    | ValidationReport
    | ((
        data: QuadSource,
        shapes: QuadSource | string,
      ) => ValidationReport | Promise<ValidationReport>);
}

/** Create an n3-backed engine that never imports or initializes Sparq/WASM. */
export function createFakeRdfEngine(opts: FakeRdfEngineOptions = {}): RdfEngine {
  let loaded = false;
  let disposed = false;
  const indexes = new Set<LocalIndex>();
  function check() {
    if (disposed) throw new Error("RDF engine is disposed");
  }
  async function ready() {
    check();
    loaded = true;
  }
  return {
    ready,
    get loaded() {
      return loaded;
    },
    get features() {
      return loaded ? { serialize: false, parseShaclCompact: false, policyEvaluate: false } : null;
    },
    async parse(input, mediaType, options) {
      await ready();
      check();
      if (formatName(mediaType) === "jsonld")
        throw new FakeEngineUnsupportedError("JSON-LD parsing");
      return parseN3(decode(input), mediaType, options);
    },
    async serialize(data, mediaType, options) {
      await ready();
      check();
      if (formatName(mediaType) === "jsonld")
        throw new FakeEngineUnsupportedError("JSON-LD serialization");
      return writeN3(data, mediaType, options);
    },
    async validate(data, shapes) {
      await ready();
      check();
      if (typeof opts.validate === "function") return opts.validate(data, shapes);
      return opts.validate ?? { conforms: true, results: [] };
    },
    async canonicalize(data) {
      await ready();
      check();
      const quads = [...data];
      if (quads.some((q) => [q.subject, q.predicate, q.object, q.graph].some(hasBlankNode))) {
        throw new FakeEngineUnsupportedError("blank-node canonicalization");
      }
      return groundCanonical(quads);
    },
    async evaluatePolicy(policy, ctx) {
      await ready();
      check();
      return evaluatePolicy(policy, ctx);
    },
    async deriveForm() {
      await ready();
      check();
      throw new FakeEngineUnsupportedError("form derivation");
    },
    async createIndex(options) {
      await ready();
      check();
      let index: LocalIndex;
      const unsupported = (operation: string): never => {
        throw new FakeEngineUnsupportedError(operation);
      };
      return createLocalIndex(
        {
          delta() {},
          release() {
            indexes.delete(index);
          },
          async select(sparql) {
            return opts.query?.select ? opts.query.select(sparql) : unsupported("select");
          },
          async ask(sparql) {
            return opts.query?.ask ? opts.query.ask(sparql) : unsupported("ask");
          },
          async construct(sparql) {
            return opts.query?.construct ? opts.query.construct(sparql) : unsupported("construct");
          },
          async selectStream(sparql) {
            if (opts.query?.selectStream) return opts.query.selectStream(sparql);
            if (!opts.query?.select) return unsupported("selectStream");
            const rows = (await opts.query.select(sparql))[Symbol.iterator]();
            return resultStream(
              () => rows.next(),
              () => {},
            );
          },
          async decodeZstd() {
            return unsupported("zstd snapshots");
          },
        },
        options,
        (owned) => {
          index = owned;
          indexes.add(owned);
        },
      );
    },
    dispose() {
      disposed = true;
      for (const index of indexes) index.dispose();
      loaded = false;
    },
  };
}
