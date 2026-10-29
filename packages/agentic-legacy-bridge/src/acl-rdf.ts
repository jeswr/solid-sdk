// AUTHORED-BY Codex GPT-6.1-Sol
import type { DataFactory as RdfFactory, Term } from "@rdfjs/types";
import { DataFactory, Lexer, Store, StreamParser, type Token, type TokenCallback } from "n3";

const MAX_ACL_BYTES = 1024 * 1024;
const MAX_ACL_QUADS = 16_384;
const MAX_ACL_DEPTH = 64;

function limit(): never {
  throw new Error("ACL read or RDF parsing budget exceeded");
}

function termBytes(term: Term, depth = 0): number {
  if (depth > MAX_ACL_DEPTH) limit();
  if (term.termType === "Quad")
    return (
      termBytes(term.subject, depth + 1) +
      termBytes(term.predicate, depth + 1) +
      termBytes(term.object, depth + 1) +
      termBytes(term.graph, depth + 1)
    );
  return (
    Buffer.byteLength(term.value) +
    (term.termType === "Literal" ? Buffer.byteLength(term.language) + termBytes(term.datatype) : 0)
  );
}

/** Reserve terms and parser work before N3 constructs or retains them. */
function parserOptions(baseIRI: string) {
  let work = 0;
  let quads = 0;
  let expanded = 0;
  const charge = (bytes: number) => {
    work += bytes;
    if (work > MAX_ACL_BYTES) limit();
  };
  const factory: RdfFactory = {
    ...DataFactory,
    namedNode<Iri extends string = string>(value: Iri) {
      charge(Buffer.byteLength(value));
      return DataFactory.namedNode(value);
    },
    blankNode(value) {
      charge(value ? Buffer.byteLength(value) : 64);
      return DataFactory.blankNode(value);
    },
    literal(value, languageOrDatatype) {
      charge(Buffer.byteLength(value));
      return (DataFactory.literal as RdfFactory["literal"])(value, languageOrDatatype);
    },
    quad(subject, predicate, object, graph = DataFactory.defaultGraph()) {
      expanded += termBytes(subject) + termBytes(predicate) + termBytes(object) + termBytes(graph);
      if (++quads > MAX_ACL_QUADS || expanded > MAX_ACL_BYTES) limit();
      return DataFactory.quad(subject, predicate, object, graph);
    },
  };
  let baseBytes = Buffer.byteLength(baseIRI);
  // N3's base-path regex can rescan long segments quadratically.
  charge(baseBytes ** 2);
  let baseDirective = false;
  const closing = new Map([
    ["[", "]"],
    ["(", ")"],
    ["{", "}"],
    ["<<", ">>"],
    ["<<(", ")>>"],
    ["{|", "|}"],
  ]);
  const pending: string[] = [];
  const meter = (token: Token) => {
    charge(1);
    const end = closing.get(token.type);
    if (end) {
      if (pending.length >= MAX_ACL_DEPTH) limit();
      charge(128);
      pending.push(end);
    } else if (pending.at(-1) === token.type) pending.pop();
    if (baseDirective && token.type === "IRI") {
      const iri = token.value ?? "";
      const bytes = Buffer.byteLength(iri);
      charge((baseBytes + bytes + 1) ** 2);
      baseBytes = /^[a-z][a-z0-9+.-]*:/i.test(iri) ? bytes : baseBytes + bytes + 1;
    }
    baseDirective = token.type === "@base" || token.type === "BASE";
  };
  const lexer = new (class extends Lexer {
    override tokenize(input: string): Token[];
    override tokenize(input: Parameters<Lexer["tokenize"]>[0], callback: TokenCallback): void;
    override tokenize(input: Parameters<Lexer["tokenize"]>[0], callback?: TokenCallback) {
      if (!callback) {
        const tokens = super.tokenize(input as string);
        for (const token of tokens) meter(token);
        return tokens;
      }
      super.tokenize(input, (error, token) => {
        if (!error) meter(token);
        callback(error, token);
      });
    }
  })({ n3: false });
  // N3 supports lexer injection, omitted from the installed @types/n3 options.
  return { format: "text/turtle", baseIRI, factory, lexer };
}

/**
 * The installed parseRdf exposes only baseIRI. Use its N3 parser directly so
 * budgets apply before quad construction, including duplicates and unused terms.
 * Feed bounded chunks and decode incrementally; never buffer the whole response.
 */
export async function readAclRdf(response: Response, baseIRI: string): Promise<Store> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let parser: StreamParser | undefined;
  try {
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_ACL_BYTES) limit();
    if (response.body === null) return new Store();
    if (!response.body || typeof response.body.getReader !== "function")
      throw new Error("ACL response body is not a readable stream");
    reader = response.body.getReader();
    parser = new StreamParser(parserOptions(baseIRI));
    const dataset = new Store();
    let failure: Error | undefined;
    parser.on("error", (error: Error) => {
      failure ??= error;
    });
    parser.on("data", (quad) => dataset.addQuad(quad));
    const decoder = new TextDecoder();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_ACL_BYTES) limit();
      // Small writes bound queued parser output from a single transport chunk.
      for (let offset = 0; offset < value.byteLength; offset += 4096) {
        parser.write(decoder.decode(value.subarray(offset, offset + 4096), { stream: true }));
        if (failure) throw failure;
      }
    }
    // N3 retains Buffers ending in a non-ASCII byte until ASCII arrives.
    // Flush that pending input before EOF, including unterminated comments.
    const complete = parser;
    await new Promise<void>((resolve, reject) => {
      complete.once("error", reject);
      complete.once("end", resolve);
      complete.end(`${decoder.decode()}\n`);
    });
    return dataset;
  } catch (error) {
    // Do not await cancellation: an injected stream's cancel hook may stall.
    void (reader ? reader.cancel() : response.body?.cancel())?.catch(() => {});
    throw error;
  } finally {
    reader?.releaseLock();
    parser?.destroy();
  }
}
