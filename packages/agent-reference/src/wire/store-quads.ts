// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import { type DatasetCore, parseRdfSync, type Quad } from "@jeswr/fetch-rdf";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { closeSync, fstatSync, openSync, readSync } from "fs";
import { type Store, Writer } from "n3";
import { IndexedStore } from "../model/indexed-store.js";

// Match the read and write budgets so an oversized block fails before append.
const STORE_QUAD_BYTES = 16 * 1024 * 1024;
const LOCAL_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const LOCAL_SNAPSHOT_QUADS = 1_000_000;
const LOCAL_TRUST_BYTES = 64 * 1024 * 1024;
const LOCAL_TRUST_TERM_CHARS = 128 * 1024 * 1024;
const LOCAL_STORE_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
type LocalStoreFormat = "application/n-quads" | "text/turtle";
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
export function writeNQuads(dataset: DatasetCore, maxBytes = STORE_QUAD_BYTES): string {
  assertNamedQuads(dataset);
  const writer = new Writer({ format: "N-Quads" });
  const lines: Buffer[] = [];
  let bytes = 0;
  for (const { subject, predicate, object, graph } of dataset) {
    const line = Buffer.from(writer.quadToString(subject, predicate, object, graph));
    bytes += line.length;
    if (bytes > maxBytes) throw new RangeError("Store RDF exceeds its byte limit");
    lines.push(line);
  }
  return Buffer.concat(lines.sort(Buffer.compare), bytes).toString("utf8");
}

export function assertCanonicalSnapshotBlock(bytes: string, dataset: DatasetCore): void {
  if (bytes !== writeNQuads(dataset, Infinity)) throw new TypeError("Noncanonical snapshot block");
}

export function readNQuads(text: string): IndexedStore {
  const parsed = parseRdfSync(text, {
    format: "application/n-quads",
    incremental: true,
    maxBytes: STORE_QUAD_BYTES,
    maxTermLength: STORE_QUAD_BYTES,
  });
  assertNamedQuads(parsed);
  return new IndexedStore([...parsed]);
}

function maxLocalBytes(format: LocalStoreFormat): number {
  return format === "text/turtle" ? LOCAL_TRUST_BYTES : LOCAL_SNAPSHOT_BYTES;
}

function checkLocalByteLength(bytes: number, format: LocalStoreFormat): void {
  if (bytes > maxLocalBytes(format))
    throw new RangeError(`Local store RDF exceeds its ${maxLocalBytes(format)}-byte limit`);
}

export function assertLocalSnapshotSize(text: string): void {
  // Every UTF-16 code unit needs at most three UTF-8 bytes.
  if (text.length > LOCAL_SNAPSHOT_BYTES / 3)
    checkLocalByteLength(Buffer.byteLength(text), "application/n-quads");
  // The snapshot writer emits one quad per line. Even the shortest N-Quads
  // statement needs more than eight UTF-16 code units.
  if (text.length <= LOCAL_SNAPSHOT_QUADS * 8) return;
  let quads = 0;
  for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n", end + 1)) {
    if (++quads > LOCAL_SNAPSHOT_QUADS)
      throw new RangeError("Local snapshot exceeds its quad limit");
  }
}

export function decodeLocalStoreUtf8(bytes: Uint8Array): string {
  return LOCAL_STORE_UTF8.decode(bytes);
}

/** Bound the file read itself, including a file that grows after opening it. */
export function readLocalStoreFile(path: string, format: LocalStoreFormat): string {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    checkLocalByteLength(size, format);
    const bytes = Buffer.allocUnsafe(size);
    let length = 0;
    while (length < size) {
      const read = readSync(fd, bytes, length, size - length, null);
      if (read === 0) break;
      length += read;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0)
      throw new Error("Local store file grew while it was being read");
    return decodeLocalStoreUtf8(bytes.subarray(0, length));
  } finally {
    closeSync(fd);
  }
}

/** Local trust Turtle also needs fixed expansion budgets for prefixes and shorthand. */
export function readLocalStoreRdf(text: string, format: LocalStoreFormat): Store {
  const bytes = Math.max(1, Buffer.byteLength(text));
  checkLocalByteLength(bytes, format);
  const turtle = format === "text/turtle";
  const parsed = parseRdfSync(text, {
    format,
    incremental: true,
    maxBytes: bytes,
    maxQuads: turtle ? 250_000 : LOCAL_SNAPSHOT_QUADS,
    maxTermLength: bytes,
    // N-Quads spells out each term. Keep headroom for implicit xsd:string datatypes.
    maxTotalTermLength: turtle ? LOCAL_TRUST_TERM_CHARS : 4 * bytes,
  });
  assertNamedQuads(parsed);
  return parsed;
}

/** Read a JSON-compatible native store value or the lexical form of an rdf:JSON literal. */
export function decodeSnapshotEntry(text: string): unknown {
  return JSON.parse(text);
}
