// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { BlankNode, Quad, Term } from "@rdfjs/types";
import type * as Wasm from "@sparq-org/sparq/wasm-node";
import { DataFactory, Store } from "n3";
import { FormGraphUnsupportedError } from "./errors.js";
import { createLocalIndex } from "./local-index.js";
import { evaluatePolicy } from "./policy.js";
import { decode, formatName, graphDocument, parseN3, writeN3 } from "./rdf.js";
import { sparqIndexBackend } from "./sparq-index.js";
import type { LocalIndex, RdfEngine, ValidationReport } from "./types.js";

/** Internal common surface of the shipped browser and Node WASM modules. */
export type Runtime = Pick<typeof Wasm, "Store" | "canonicalizeNQuads"> & {
  policyEvaluate?: unknown;
  policyContractVersion?: unknown;
};

type JsonTerm =
  | {
      type: "uri" | "bnode" | "literal";
      value: string;
      datatype?: string;
      "xml:lang"?: string;
      "its:dir"?: string;
    }
  | { type: "triple"; value: unknown };

/** Conservative syntax check, including scoped contexts and context arrays. */
function hasNullContext(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, entry]) =>
      (key === "@context" && (entry === null || (Array.isArray(entry) && entry.includes(null)))) ||
      hasNullContext(entry),
  );
}

/** Materialize both graph scopes; no WASM handle escapes a document operation. */
function dataset(store: Wasm.Store): Store {
  // Labels identify nodes only within this document, including across its graph scopes.
  const blankNodes = new Map<string, BlankNode>();
  function term(value: JsonTerm): Term {
    if (value.type === "uri") return DataFactory.namedNode(value.value);
    if (value.type === "bnode") {
      let node = blankNodes.get(value.value);
      if (!node) {
        node = DataFactory.blankNode();
        blankNodes.set(value.value, node);
      }
      return node;
    }
    if (value.type !== "literal") {
      throw new TypeError(`Unsupported RDF term type: ${value.type}`);
    }
    if (value["its:dir"] !== undefined) {
      throw new TypeError(`Unsupported RDF literal direction: ${value["its:dir"]}`);
    }
    return DataFactory.literal(
      value.value,
      value["xml:lang"] || (value.datatype ? DataFactory.namedNode(value.datatype) : undefined),
    );
  }
  const result = new Store();
  for (const query of [
    "SELECT ?s ?p ?o WHERE { ?s ?p ?o }",
    "SELECT ?s ?p ?o ?g WHERE { GRAPH ?g { ?s ?p ?o } }",
  ]) {
    const rows = JSON.parse(store.query(query)) as {
      results: { bindings: Record<string, JsonTerm>[] };
    };
    for (const row of rows.results.bindings) {
      result.add(
        DataFactory.quad(
          term(row.s as JsonTerm) as Quad["subject"],
          term(row.p as JsonTerm) as Quad["predicate"],
          term(row.o as JsonTerm) as Quad["object"],
          row.g ? (term(row.g) as Quad["graph"]) : undefined,
        ),
      );
    }
  }
  return result;
}

export function createEngine(load: () => Promise<Runtime>): RdfEngine {
  let pending: Promise<void> | undefined;
  let runtime: Runtime | undefined;
  let disposed = false;
  let features: RdfEngine["features"] = null;
  const indexes = new Set<LocalIndex>();
  function check() {
    if (disposed) throw new Error("RDF engine is disposed");
  }
  async function ready() {
    check();
    pending ??= load()
      .then((module) => {
        check();
        runtime = module;
        features = {
          policyEvaluate:
            typeof module.policyEvaluate === "function" &&
            typeof module.policyContractVersion === "number" &&
            Number.isFinite(module.policyContractVersion) &&
            module.policyContractVersion >= 1,
          serialize: typeof module.Store.prototype.serialize === "function",
          parseShaclCompact: typeof module.Store.prototype.parseShaclCompact === "function",
        };
      })
      .catch((error) => {
        pending = undefined;
        throw error;
      });
    await pending;
    check();
  }
  async function use<T>(operation: (module: Runtime) => T | Promise<T>): Promise<T> {
    await ready();
    check();
    return operation(runtime as Runtime);
  }
  function withStore<T>(store: Wasm.Store, operation: (store: Wasm.Store) => T): T {
    try {
      return operation(store);
    } finally {
      store.free();
    }
  }
  return {
    ready,
    get loaded() {
      return runtime !== undefined;
    },
    get features() {
      return features;
    },
    parse(input, mediaType, opts) {
      return use(({ Store: WasmStore }) => {
        const format = formatName(mediaType);
        let text = decode(input);
        if (opts?.baseIri && format === "jsonld") {
          const document: unknown = JSON.parse(text);
          // Graph keywords may appear as keys, aliases or @container values. Without
          // them, the native graph loader safely sets the actual document base.
          if (!JSON.stringify(document).includes('"@graph"')) {
            return withStore(WasmStore.loadWithBase(text, format, opts.baseIri), dataset);
          }
          // 0.1.5 has no dataset/base loader. Keep the graph-preserving wrapper only
          // where a context reset cannot discard its inherited base. Scan syntax
          // conservatively rather than reimplement JSON-LD context/value expansion.
          if (hasNullContext(document)) {
            throw new TypeError(
              "Sparq 0.1.5 cannot combine a JSON-LD base, graph syntax and null contexts",
            );
          }
          text = JSON.stringify({
            "@context": { "@base": opts.baseIri },
            "@graph": document,
          });
        }
        // 0.1.5 has no dataset-preserving base loader. Resolve TriG with n3 first.
        if (opts?.baseIri && format === "trig") {
          text = writeN3(parseN3(text, mediaType, opts), "application/n-quads");
          return withStore(WasmStore.loadDataset(text, "nquads"), dataset);
        }
        const store =
          opts?.baseIri && format === "turtle"
            ? WasmStore.loadWithBase(text, format, opts.baseIri)
            : WasmStore.loadDataset(text, format);
        return withStore(store, dataset);
      });
    },
    serialize(data, mediaType, opts) {
      return use(({ Store: WasmStore }) => {
        const format = formatName(mediaType);
        const quads = [...data];
        if (format === "ntriples" || format === "nquads") return writeN3(quads, mediaType);
        return withStore(
          WasmStore.loadDataset(writeN3(quads, "application/n-quads"), "nquads"),
          (store) => {
            if (typeof store.serialize !== "function") {
              throw new Error("Sparq bundle lacks serialize (requires serialize-rdf)");
            }
            return store.serialize(
              format,
              opts?.pretty ?? true,
              undefined,
              true,
              opts?.prefixes ? Object.entries(opts.prefixes) : undefined,
            );
          },
        );
      });
    },
    validate(data, shapes) {
      return use(({ Store: WasmStore }) =>
        withStore(WasmStore.load("", "turtle"), (store) => {
          const shapesText = typeof shapes === "string" ? shapes : graphDocument(shapes);
          return JSON.parse(
            store.validate(graphDocument(data), shapesText, "turtle"),
          ) as ValidationReport;
        }),
      );
    },
    canonicalize(data) {
      return use((module) => module.canonicalizeNQuads(writeN3(data, "application/n-quads")));
    },
    evaluatePolicy(policy, ctx) {
      // A marker is a prerequisite for a future adapter, not permission to call
      // today's experimental probe with its incompatible context/semantics.
      return use(() => evaluatePolicy(policy, ctx));
    },
    deriveForm(data, shapes, focus, opts) {
      return use(({ Store: WasmStore }) => {
        for (const [input, quads] of [
          ["data", data],
          ["shapes", shapes],
        ] as const) {
          for (const quad of quads) {
            if (quad.graph.termType !== "DefaultGraph") throw new FormGraphUnsupportedError(input);
          }
        }
        return withStore(WasmStore.load("", "turtle"), (store) => {
          if (typeof store.deriveForm !== "function") {
            throw new Error("Sparq bundle lacks deriveForm (requires forms)");
          }
          return JSON.parse(
            store.deriveForm(
              writeN3(data, "application/n-quads"),
              writeN3(shapes, "application/n-quads"),
              focus,
              "nquads",
              JSON.stringify(opts),
            ),
          ) as unknown;
        });
      });
    },
    createIndex(opts) {
      return use(async ({ Store: WasmStore }) => {
        const helpers = await import("@sparq-org/sparq");
        check();
        const store = WasmStore.loadDataset("", "nquads");
        let index: LocalIndex;
        const backend = sparqIndexBackend(store, () => indexes.delete(index), helpers);
        return createLocalIndex(backend, opts, (owned) => {
          index = owned;
          indexes.add(owned);
        });
      });
    },
    dispose() {
      disposed = true;
      for (const index of indexes) index.dispose();
      runtime = undefined;
      features = null;
    },
  };
}
