// AUTHORED-BY Codex GPT-6.1-Sol
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { RdfFetchError, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import type { DataFactory as RdfFactory, Term } from "@rdfjs/types";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { JsonLdParser } from "jsonld-streaming-parser";
import type { ParsingContext } from "jsonld-streaming-parser/lib/ParsingContext.js";
import {
  DataFactory,
  Lexer,
  Store,
  StreamParser,
  type Token,
  type TokenCallback,
  Writer,
} from "n3";
import {
  decodePrefix,
  limitedBody,
  MAX_CONTENT_BYTES,
  mediaType,
  normalizeLocalJsonLd,
} from "./content.js";

/** Bound object overhead even for tiny or duplicate statements. */
export const MAX_RDF_QUADS = 16_384;

export class RdfLimitError extends Error {
  constructor() {
    super("RDF expansion/output budget exhausted.");
  }
}

function termBytes(term: Term, depth = 0): number {
  if (depth > 64) throw new RdfLimitError();
  if (term.termType === "Quad") {
    return (
      termBytes(term.subject, depth + 1) +
      termBytes(term.predicate, depth + 1) +
      termBytes(term.object, depth + 1) +
      termBytes(term.graph, depth + 1)
    );
  }
  return (
    Buffer.byteLength(term.value) +
    (term.termType === "Literal" ? Buffer.byteLength(term.language) + termBytes(term.datatype) : 0)
  );
}

/** Check expanded terms before constructing each quad, including duplicates. */
function budgetedFactory(charge: (bytes: number) => void): RdfFactory {
  let quads = 0;
  let bytes = 0;
  return {
    ...DataFactory,
    // Also bound expanded declarations and terms that never reach a quad.
    namedNode<Iri extends string = string>(value: Iri) {
      charge(Buffer.byteLength(value));
      return DataFactory.namedNode(value);
    },
    blankNode(value) {
      // Reserve the generated label and node overhead before the factory runs,
      // including anonymous nodes that never contribute to an emitted quad.
      charge(value ? Buffer.byteLength(value) : 64);
      return DataFactory.blankNode(value);
    },
    // JSON-LD passes native scalars for typed values and null for absent metadata.
    literal(value, languageOrDatatype) {
      const lexicalValue = String(value);
      charge(Buffer.byteLength(lexicalValue));
      // N3 2 supports directional languages; @types/n3 still omits that overload.
      return (DataFactory.literal as RdfFactory["literal"])(
        lexicalValue,
        languageOrDatatype ?? undefined,
      );
    },
    quad(subject, predicate, object, graph = DataFactory.defaultGraph()) {
      bytes += termBytes(subject) + termBytes(predicate) + termBytes(object) + termBytes(graph);
      if (++quads > MAX_RDF_QUADS || bytes > MAX_CONTENT_BYTES) throw new RdfLimitError();
      return DataFactory.quad(subject, predicate, object, graph);
    },
  };
}

/** Meter N3 contexts and base resolution before forwarding tokens to the parser. */
function budgetN3Lexer(format: string, baseIRI: string, charge: (bytes: number) => void) {
  let baseBytes = Buffer.byteLength(baseIRI);
  // N3's base-path normalization regex can rescan a long path segment from
  // every position. Charge its quadratic worst case, including the initial
  // base processed by the parser constructor, before entering that work.
  charge(baseBytes ** 2);
  let baseDirective = false;
  const closingTokens = new Map([
    ["[", "]"],
    ["(", ")"],
    ["{", "}"],
    ["<<", ">>"],
    ["<<(", ")>>"],
    ["{|", "|}"],
  ]);
  const pending: string[] = [];
  const meter = (token: Token) => {
    const closing = closingTokens.get(token.type);
    if (closing) {
      // N3 retains a context object before any quad is available to meter.
      // Charge cumulatively, so repeated empty structures consume the budget
      // too. Count graph/annotation scopes conservatively alongside contexts.
      if (pending.length >= 64) throw new RdfLimitError();
      charge(128);
      pending.push(closing);
    } else if (pending.at(-1) === token.type) pending.pop();
    if (baseDirective && token.type === "IRI") {
      const iri = token.value ?? "";
      const bytes = Buffer.byteLength(iri);
      // Reserve work BEFORE N3 resolves, normalizes and copies the base. A
      // relative resolution is no longer than base + reference + one slash.
      // Keep an upper bound so we never resolve attacker IRIs a second time.
      charge((baseBytes + bytes + 1) ** 2);
      baseBytes = /^[a-z][a-z0-9+.-]*:/i.test(iri) ? bytes : baseBytes + bytes + 1;
    }
    baseDirective = token.type === "@base" || token.type === "BASE";
  };
  return new (class extends Lexer {
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
  })({
    lineMode: format === "application/n-triples" || format === "application/n-quads",
    n3: false,
  });
}

/** Bound buffered jobs and key-path copying before streaming parsing starts. */
function budgetJsonLdStructure(value: unknown, charge: (bytes: number) => void, depth = 0): void {
  if (depth > 64) throw new RdfLimitError();
  // Reserve per-job overhead and depth-weighted path work for EVERY value,
  // including empty containers, ignored properties and opaque JSON literals.
  // Key-path scans can themselves copy each prefix, hence the squared depth.
  charge(8 + (depth + 1) ** 2);
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) budgetJsonLdStructure(child, charge, depth + 1);
  }
}

/** Context normalization never calls the RDF factory. Account for it separately. */
function budgetJsonLdContexts(parser: JsonLdParser, charge: (bytes: number) => void): void {
  // Version 5 has no context-parser injection option. Keep this instance-local
  // adapter at the parser boundary; never patch shared library prototypes.
  const contextParser = (parser as unknown as { parsingContext: ParsingContext }).parsingContext
    .contextParser;
  const stringBytes = (value: unknown) =>
    typeof value === "string" ? Buffer.byteLength(value) : 0;
  function chargeContext(value: unknown, depth = 0): void {
    if (depth > 64) {
      charge(MAX_CONTENT_BYTES + 1);
      return;
    }
    if (typeof value === "string") charge(stringBytes(value));
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        charge(stringBytes(key));
        chargeContext(child, depth + 1);
      }
    }
  }
  type Context = Parameters<typeof contextParser.expandPrefixedTerms>[0];
  function expansionSize(context: ReturnType<Context["getContextRaw"]>): number {
    let maximum = 0;
    for (const value of Object.values(context)) {
      maximum = Math.max(maximum, stringBytes(value), stringBytes(value?.["@id"]));
    }
    // Covers prefix concatenation and relative @vocab resolution through @base.
    return maximum + stringBytes(context["@base"]) + stringBytes(context["@vocab"]);
  }
  const parse = contextParser.parse.bind(contextParser);
  contextParser.parse = (...args) => {
    // Charge copies/inheritance before the normalizer clones or retains them.
    chargeContext(args[0]);
    chargeContext(args[1]?.parentContext);
    return parse(...args);
  };
  const applyBase = contextParser.applyBaseEntry.bind(contextParser);
  contextParser.applyBaseEntry = (context, options, inherit) => {
    charge(
      stringBytes(context?.["@base"]) +
        stringBytes(options.parentContext?.["@base"]) +
        stringBytes(options.baseIRI),
    );
    return applyBase(context, options, inherit);
  };
  const inner = contextParser.parseInnerContexts.bind(contextParser);
  contextParser.parseInnerContexts = (context, ...args) => {
    // @vocab can expand before expandPrefixedTerms is called, including arrays
    // that concatenate a new relative vocab with the inherited vocabulary.
    if (typeof context["@vocab"] === "string") {
      charge(expansionSize(context) + stringBytes(context["@vocab"]));
    }
    return inner(context, ...args);
  };
  const expand = contextParser.expandPrefixedTerms.bind(contextParser);
  contextParser.expandPrefixedTerms = (context, ...args) => {
    let maximum = expansionSize(context.getContextRaw());
    const expandTerm = context.expandTerm.bind(context);
    context.expandTerm = (term, ...options) => {
      // Reserve a conservative UTF-8 upper bound BEFORE concatenating. Update
      // it on every step so chained prefixes cannot grow unchecked.
      charge(maximum + stringBytes(term));
      const result = expandTerm(term, ...options);
      maximum = Math.max(maximum, stringBytes(result));
      return result;
    };
    try {
      expand(context, ...args);
    } finally {
      context.expandTerm = expandTerm;
    }
  };
}

/**
 * The pinned parseRdf API only exposes baseIRI, with no quad/factory budget seam.
 * Use its existing parser libraries here so limits apply before Store insertion.
 * Input is already byte-capped; JSON-LD is normalized and uses a refusing loader.
 */
export async function parseBoundedRdf(source: string, contentType: string, baseIRI: string) {
  const format = contentType === "application/x-turtle" ? "text/turtle" : contentType;
  if (!(SUPPORTED_RDF_MEDIA_TYPES as readonly string[]).includes(format)) {
    throw new RdfFetchError(`Unsupported RDF media type: ${format}`, { contentType: format });
  }
  let allocatedBytes = 0;
  const charge = (bytes: number) => {
    allocatedBytes += bytes;
    if (allocatedBytes > MAX_CONTENT_BYTES) throw new RdfLimitError();
  };
  const input = Buffer.from(
    format === "application/ld+json"
      ? normalizeLocalJsonLd(source, (document) => budgetJsonLdStructure(document, charge))
      : source,
  );
  const factory = budgetedFactory(charge);
  // N3 supports lexer injection, omitted from the installed @types/n3 options.
  const n3Options =
    format === "application/ld+json"
      ? undefined
      : {
          format,
          baseIRI,
          factory,
          lexer: budgetN3Lexer(format, baseIRI, charge),
        };
  const parser =
    format === "application/ld+json"
      ? new JsonLdParser({
          baseIRI,
          dataFactory: factory,
          documentLoader: {
            async load() {
              throw new Error("Remote JSON-LD contexts are disabled (SSRF guard).");
            },
          },
        })
      : new StreamParser(n3Options);
  if (parser instanceof JsonLdParser) budgetJsonLdContexts(parser, charge);
  const dataset = new Store();
  // Small chunks keep parser queues bounded as well as the retained dataset.
  function* chunks() {
    for (let offset = 0; offset < input.length; offset += 4096) {
      yield input.subarray(offset, offset + 4096);
    }
    // N3 holds any Buffer ending in a non-ASCII byte until an ASCII byte
    // arrives. Flush that pending input before EOF; JSON-LD needs no sentinel.
    if (format !== "application/ld+json") yield Buffer.from("\n");
  }
  try {
    await pipeline(
      Readable.from(chunks()),
      parser,
      new Writable({
        objectMode: true,
        write(quad, _encoding, done) {
          dataset.addQuad(quad);
          done();
        },
      }),
    );
  } catch (error) {
    // Scoped-context validation wraps thrown errors, discarding their class.
    if (allocatedBytes > MAX_CONTENT_BYTES) throw new RdfLimitError();
    throw error;
  }
  return dataset;
}

/** Negotiated, bounded RDF reads for every search discovery/scan path. */
export async function fetchBoundedRdf(url: string, options: { fetch: typeof fetch }) {
  const response = await options.fetch(url, {
    headers: { accept: "text/turtle, application/ld+json;q=0.9" },
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new RdfFetchError(`HTTP ${response.status} fetching ${url}`, { status: response.status });
  }
  const { bytes, truncated } = await limitedBody(response);
  if (truncated) throw new RdfLimitError();
  const dataset = await parseBoundedRdf(
    decodePrefix(bytes, false),
    mediaType(response.headers.get("content-type") ?? "text/turtle"),
    response.url || url,
  );
  return { dataset, headers: response.headers };
}

/** Write a union graph without ever accumulating an oversized Turtle string. */
export function serializeBoundedTurtle(dataset: Store): string {
  const view = new Store();
  for (const graph of dataset.getGraphs(null, null, null)) {
    for (const quad of new NamedGraphDataset(graph, dataset, DataFactory)) view.addQuad(quad);
  }
  const chunks: string[] = [];
  let bytes = 0;
  let failure: Error | undefined;
  const writer = new Writer(
    {
      write(chunk: string, _encoding: string, done?: () => void) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_CONTENT_BYTES) failure = new RdfLimitError();
        if (!failure) chunks.push(chunk);
        done?.();
      },
      end(done?: () => void) {
        done?.();
      },
    },
    { format: "text/turtle" },
  );
  for (const quad of view) {
    writer.addQuad(quad.subject, quad.predicate, quad.object, quad.graph, (error?: Error) => {
      if (error) failure = error;
    });
    if (failure) throw failure;
  }
  writer.end((error) => {
    if (error) failure = error;
  });
  if (failure) throw failure;
  return chunks.join("");
}
