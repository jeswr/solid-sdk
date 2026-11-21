// AUTHORED-BY Codex GPT-6.2 Sol
import { type DatasetCore, parseRdfSync, type Quad } from "@jeswr/fetch-rdf";
import { Writer } from "n3";
import { IndexedStore } from "../model/indexed-store.js";

// Match the read and write budgets so an oversized block fails before append.
const STORE_QUAD_BYTES = 16 * 1024 * 1024;
// In Unicode mode, astral code points are matched whole. A match is unpaired.
const UNPAIRED_SURROGATE = /[\ud800-\udfff]/u;

function assertNamedQuads(dataset: Iterable<Quad>): void {
  for (const { subject, predicate, object, graph } of dataset) {
    if (
      subject.termType !== "NamedNode" ||
      predicate.termType !== "NamedNode" ||
      (object.termType !== "NamedNode" && object.termType !== "Literal") ||
      (graph.termType !== "NamedNode" && graph.termType !== "DefaultGraph")
    )
      throw new TypeError("Store RDF requires named nodes");
    for (const term of [subject, predicate, object, graph]) {
      if (
        UNPAIRED_SURROGATE.test(term.value) ||
        (term.termType === "Literal" && UNPAIRED_SURROGATE.test(term.datatype.value))
      )
        throw new TypeError("Store RDF requires well-formed Unicode");
    }
  }
}

/** Synchronous deterministic N-Quads. Sort the serialized UTF-8 lines bytewise. */
export function writeNQuads(dataset: DatasetCore): string {
  assertNamedQuads(dataset);
  const writer = new Writer({ format: "N-Quads" });
  const lines: Buffer[] = [];
  let bytes = 0;
  for (const { subject, predicate, object, graph } of dataset) {
    const line = Buffer.from(writer.quadToString(subject, predicate, object, graph));
    bytes += line.length;
    if (bytes > STORE_QUAD_BYTES) throw new RangeError("Store RDF exceeds its byte limit");
    lines.push(line);
  }
  return Buffer.concat(lines.sort(Buffer.compare), bytes).toString("utf8");
}

export function readNQuads(text: string, maxBytes = STORE_QUAD_BYTES): IndexedStore {
  const parsed = parseRdfSync(text, {
    format: "application/n-quads",
    maxBytes,
    maxTermLength: STORE_QUAD_BYTES,
  });
  assertNamedQuads(parsed);
  return new IndexedStore([...parsed]);
}

/** Parse an entry from the memo’s own JSON.stringify output, matching legacy state semantics. */
export function decodeSnapshotEntry(text: string): unknown {
  return JSON.parse(text);
}
