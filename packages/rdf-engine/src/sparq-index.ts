// AUTHORED-BY Codex GPT-6
import type { Term } from "@rdfjs/types";
import type { Store } from "@sparq-org/sparq/wasm-node";
import { DataFactory } from "n3";
import type { IndexBackend } from "./local-index.js";
import { decode, parseN3, writeN3 } from "./rdf.js";
import { resultStream } from "./result-stream.js";
import type { Bindings } from "./types.js";

type JsonTerm = {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
  "its:dir"?: string;
};
function term(value: JsonTerm): Term {
  if (value.type === "uri") return DataFactory.namedNode(value.value);
  if (value.type === "bnode") return DataFactory.blankNode(value.value);
  if (value.type !== "literal" || value["its:dir"] !== undefined) {
    throw new TypeError("Unsupported RDF query term");
  }
  return DataFactory.literal(
    value.value,
    value["xml:lang"] || (value.datatype ? DataFactory.namedNode(value.datatype) : undefined),
  );
}

/** Check only the query form after the SPARQL prologue; Sparq validates the grammar. */
function assertSelect(sparql: string) {
  let rest = sparql;
  const skip = () => {
    rest = rest.replace(/^(?:\s+|#[^\r\n]*(?:\r?\n|$))*/, "");
  };
  skip();
  while (/^(?:BASE|PREFIX)\b/i.test(rest)) {
    const prefix = /^PREFIX\b/i.test(rest);
    rest = rest.replace(/^(?:BASE|PREFIX)\b/i, "");
    skip();
    if (prefix) {
      const name = /^[^\s:]*:/.exec(rest);
      if (!name) throw new TypeError("Expected a SELECT query");
      rest = rest.slice(name[0].length);
      skip();
    }
    const iri = /^<[^>]*>/.exec(rest);
    if (!iri) throw new TypeError("Expected a SELECT query");
    rest = rest.slice(iri[0].length);
    skip();
  }
  if (!/^SELECT\b/i.test(rest)) throw new TypeError("Expected a SELECT query");
}

/** Uses the engine's raw binding, so Node and browser stores never cross WASM runtimes. */
export function sparqIndexBackend(
  store: Store,
  release: () => void,
  { Bindings, decompress }: Pick<typeof import("@sparq-org/sparq"), "Bindings" | "decompress">,
): IndexBackend {
  function rows(json: string): Bindings[] {
    const result = JSON.parse(json) as { results?: { bindings: Record<string, JsonTerm>[] } };
    if (!result.results) throw new TypeError("Expected a SELECT query");
    return result.results.bindings.map(
      (row) =>
        new Bindings(
          Object.entries(row).map(([name, value]) => [DataFactory.variable(name), term(value)]),
        ),
    );
  }
  return {
    delta(inserts, deletes) {
      store.applyDelta(
        writeN3(inserts, "application/n-quads"),
        writeN3(deletes, "application/n-quads"),
      );
    },
    release() {
      store.free();
      release();
    },
    async select(sparql) {
      assertSelect(sparql);
      return rows(store.query(sparql));
    },
    async selectStream(sparql) {
      assertSelect(sparql);
      const cursor = store.queryCursor(sparql, 256);
      let batch: Bindings[] = [];
      let offset = 0;
      const stream = resultStream<Bindings>(
        () => {
          while (offset === batch.length) {
            const json = cursor.next();
            if (json === undefined) return { done: true, value: undefined };
            batch = rows(json);
            offset = 0;
          }
          return { done: false, value: batch[offset++] as Bindings };
        },
        () => {
          batch = [];
          cursor.free();
        },
      );
      return stream;
    },
    async ask(sparql) {
      return store.ask(sparql);
    },
    async construct(sparql) {
      return [...parseN3(store.queryQuads(sparql), "application/n-triples")];
    },
    async decodeZstd(bytes) {
      return decode(await decompress(bytes, "zstd"));
    },
  };
}
