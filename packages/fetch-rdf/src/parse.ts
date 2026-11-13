// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * RDF parsing dispatch — body in, dataset out.
 *
 * Mirrors the {@link https://solidproject.org/TR/protocol Solid Protocol v0.11.0 §5.2}
 * "RDF documents are served as `text/turtle` or `application/ld+json`"
 * guarantee: Solid only uses Turtle and JSON-LD in the wild, so we
 * dispatch on the response `Content-Type` and call the relevant native
 * parser directly. N-Triples and N-Quads are routed through n3 too,
 * since the n3 parser handles them natively.
 *
 * Stream bodies feed n3's `StreamParser` or `jsonld-streaming-parser`
 * as chunks arrive, pushing each quad straight into an `N3.Store`
 * without buffering the response. Already-buffered N3-family strings
 * use n3's synchronous `Parser`, preserving the published API's
 * completion timing for promise-based UI consumers.
 *
 * @packageDocumentation
 */

import type { DatasetCore, Quad } from "@rdfjs/types";
import contentType from "content-type";
import { JsonLdParser } from "jsonld-streaming-parser";
import { Parser, Store, StreamParser } from "n3";
import {
  budgetFactory,
  bufferBody,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_JSON_DEPTH,
  DEFAULT_MAX_QUADS,
  jsonDepthScanner,
  limit,
  parseLimit,
  utf8Length,
} from "./budgets.js";
import { parseDocumentLoader } from "./document-loader.js";
import { RdfFetchError } from "./errors.js";
import { SUPPORTED_RDF_MEDIA_TYPES } from "./media-types.js";
import { abortable, abortError, checkAbort, isAbortError } from "./operation.js";
import { redactUrl } from "./redact.js";
import type { ParseRdfOptions, ParseRdfSyncOptions, RdfMediaType } from "./types.js";

export { SUPPORTED_RDF_MEDIA_TYPES } from "./media-types.js";

const N3_FAMILY = new Set<string>(
  SUPPORTED_RDF_MEDIA_TYPES.filter((type) => type !== "application/ld+json"),
);
const JSON_LD_FAMILY = new Set<string>(["application/ld+json"]);

/** A body we can stream-parse: either a raw string (already in memory)
 * or a web `ReadableStream` of UTF-8 bytes (typically `Response.body`). */
export type RdfBody = string | ReadableStream<Uint8Array>;

/** Minimal structural type for the parsers we use — both n3's
 * `StreamParser` and `JsonLdParser` are `readable-stream` `Transform`
 * streams, which work identically in Node and browsers (the
 * `readable-stream` package is the userland portable shim). We
 * deliberately use only the EventEmitter / `write` / `drain` / `end`
 * methods from this surface so nothing in this module reaches for a
 * Node-only API like `node:stream` or `node:stream/promises`. */
interface QuadTransform {
  on(event: "data", listener: (quad: Quad) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  once(event: "drain", listener: () => void): this;
  once(event: "error", listener: (err: Error) => void): this;
  off(event: "drain", listener: () => void): this;
  off(event: "error", listener: (err: Error) => void): this;
  write(chunk: string): boolean;
  end(chunk?: string): void;
  destroy(error?: Error): void;
}

/**
 * Parse buffered N3-family RDF without changing a synchronous caller's contract.
 * JSON-LD and streams require {@link parseRdf}. Omitted format retains n3's
 * permissive syntax detection; an explicit format restricts accepted syntax.
 */
export function parseRdfSync(body: string, options: ParseRdfSyncOptions = {}): Store {
  const { format, baseIRI } = options;
  try {
    options.check?.();
    checkAbort(options.signal);
    if (utf8Length(body) > limit(options.maxBytes, DEFAULT_MAX_BYTES, "maxBytes"))
      throw parseLimit("maxBytes");
    if (format !== undefined && !N3_FAMILY.has(format)) {
      throw new RdfFetchError(`Unsupported synchronous RDF media type: "${format}".`, {
        contentType: format,
      });
    }
    return parseBufferedN3(body, options, options.signal ?? new AbortController().signal);
  } catch (cause) {
    if (options.signal?.aborted) throw abortError(options.signal);
    throw parseError(cause, format ?? "text/turtle", format ?? "text/turtle", baseIRI);
  }
}

/** Shared by the promise API and synchronous consumers; enforce checks during insertion too. */
function parseBufferedN3(body: string, options: ParseRdfSyncOptions, signal: AbortSignal): Store {
  const budget = budgetFactory(options, signal, options.check);
  const parser = new Parser({
    format: options.format,
    baseIRI: options.baseIRI,
    factory: budget.factory,
  });
  budget.start();
  const quads = parser.parse(body);
  const store = createStore(options);
  for (const quad of quads) {
    options.check?.();
    checkAbort(signal);
    store.addQuad(quad);
    options.onQuad?.(quad);
  }
  options.check?.();
  checkAbort(signal);
  return store;
}

/**
 * Parse a Turtle / N-Triples / N-Quads / TriG / JSON-LD body into a
 * fresh in-memory N3 {@link Store} by default. With `engine`, return its
 * dataset as RDF/JS DatasetCore after buffering any stream input.
 *
 * Stream bodies are consumed incrementally: each chunk is written
 * straight into the relevant streaming parser, and each emitted quad
 * is added straight to the store. N3-family strings already in memory
 * are parsed synchronously, without waiting for stream lifecycle events.
 *
 * @param body - Either the body as a string (when already in memory)
 *   or a web `ReadableStream<Uint8Array>` (typically `Response.body`).
 * @param contentTypeHeader - The raw `Content-Type` response header
 *   value. `null` is treated as `text/turtle` (the Solid Protocol §5.2
 *   default).
 * @param options - Optional. `baseIRI` is used to resolve relative
 *   references in the body — in practice the resource URL itself.
 * @throws {@link RdfFetchError} if the media type isn't one of
 *   {@link SUPPORTED_RDF_MEDIA_TYPES}, if the Content-Type header is
 *   malformed, or if the underlying parser throws.
 */
export function parseRdf(
  body: RdfBody,
  contentTypeHeader: string | null,
  options?: ParseRdfOptions & { engine?: undefined },
): Promise<Store>;
export function parseRdf(
  body: RdfBody,
  contentTypeHeader: string | null,
  options?: ParseRdfOptions,
): Promise<DatasetCore>;
export async function parseRdf(
  body: RdfBody,
  contentTypeHeader: string | null,
  options: ParseRdfOptions = {},
): Promise<DatasetCore> {
  const rawHeader = contentTypeHeader ?? "text/turtle";
  let mediaType: string;
  try {
    mediaType = contentType.parse(rawHeader).type;
  } catch (cause) {
    throw new RdfFetchError(`Invalid Content-Type header: "${rawHeader}".`, {
      cause,
      contentType: rawHeader,
    });
  }

  const baseIRI = options.baseIRI;
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  const signal = controller.signal;
  try {
    checkAbort(signal);
    const maxBytes = limit(options.maxBytes, DEFAULT_MAX_BYTES, "maxBytes");
    if (typeof body === "string" && utf8Length(body) > maxBytes) throw parseLimit("maxBytes");
    if (!N3_FAMILY.has(mediaType) && !JSON_LD_FAMILY.has(mediaType)) {
      throw new RdfFetchError(
        `Unsupported RDF media type: "${mediaType}". Supported: ${SUPPORTED_RDF_MEDIA_TYPES.join(", ")}.`,
        { contentType: rawHeader, ...(baseIRI !== undefined && { url: baseIRI }) },
      );
    }
    if (options.engine) {
      const input = typeof body === "string" ? body : await bufferBody(body, maxBytes, signal);
      // The engine is the fast path, so it is not pre-parsed by the default parser: it
      // gets byte-capped input, applies its own parse limits, and the quad budget is
      // re-checked on its result.
      const dataset = await abortable(
        options.engine.parse(input, mediaType as RdfMediaType, {
          ...(baseIRI !== undefined && { baseIri: baseIRI }),
        }),
        signal,
      );
      checkAbort(signal);
      const maxQuads = limit(options.maxQuads, DEFAULT_MAX_QUADS, "maxQuads");
      if (dataset.size > maxQuads) throw parseLimit("maxQuads");
      return dataset;
    }
    return await parseDefault(body, mediaType, options, signal, maxBytes);
  } catch (cause) {
    if (typeof body !== "string" && !body.locked) void body.cancel().catch(() => {});
    if (signal.aborted || isAbortError(cause)) throw abortError(signal);
    throw parseError(cause, mediaType, rawHeader, baseIRI);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    // Cancel sibling/queued context work on failure, and remove all outstanding listeners.
    controller.abort();
  }
}

/** One error factory for all parser backends, preserving structured failures. */
function parseError(
  cause: unknown,
  mediaType: string,
  rawHeader: string,
  baseIRI?: string,
): RdfFetchError {
  if (cause instanceof RdfFetchError && cause.code === undefined && cause.contentType !== undefined)
    return cause;
  return new RdfFetchError(
    `Failed to parse ${mediaType} body${baseIRI ? ` at ${redactUrl(baseIRI)}` : ""}.`,
    {
      cause,
      ...(cause instanceof RdfFetchError && { code: cause.code }),
      contentType: rawHeader,
      ...(baseIRI !== undefined && { url: baseIRI }),
    },
  );
}

function parseDefault(
  body: RdfBody,
  mediaType: string,
  options: ParseRdfOptions,
  signal: AbortSignal,
  maxBytes: number,
): Promise<Store> {
  if (N3_FAMILY.has(mediaType) && typeof body === "string") {
    // Keep buffered N3 settlement within a consumer's microtask flush. The
    // factory enforces budgets before the synchronous parser retains each quad.
    return Promise.resolve(
      parseBufferedN3(
        body,
        { ...options, format: mediaType as ParseRdfSyncOptions["format"] },
        signal,
      ),
    );
  }
  const baseIRI = options.baseIRI;
  const budget = budgetFactory(options, signal);
  const factory = budget.factory;
  const checkChunk = JSON_LD_FAMILY.has(mediaType)
    ? jsonDepthScanner(limit(options.maxJsonDepth, DEFAULT_MAX_JSON_DEPTH, "maxJsonDepth"))
    : undefined;
  let parser: QuadTransform;
  let rejectFailure!: (error: unknown) => void;
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  let cancelPump = (_error: Error) => {};
  const fail = (error: unknown) => {
    // An abort reason may be any value; internal stream teardown needs an Error.
    const asError =
      error instanceof Error ? error : new DOMException("The operation was aborted.", "AbortError");
    cancelPump(asError);
    rejectFailure(error);
    parser.destroy(asError);
  };
  parser = N3_FAMILY.has(mediaType)
    ? (new StreamParser({ format: mediaType, baseIRI, factory }) as unknown as QuadTransform)
    : (new JsonLdParser({
        baseIRI,
        dataFactory: factory,
        documentLoader: parseDocumentLoader(options, signal, fail),
      }) as unknown as QuadTransform);
  budget.start();
  const onAbort = () => fail(abortError(signal));
  signal.addEventListener("abort", onAbort, { once: true });
  const storePromise = collectIntoStore(parser, options);
  const pumpPromise = pumpBody(parser, body, maxBytes, signal, checkChunk, (cancel) => {
    cancelPump = cancel;
  }).catch((cause: unknown) => {
    parser.destroy(cause instanceof Error ? cause : new Error(String(cause)));
    throw cause;
  });
  // Observe every promise immediately, but never await a stalled sibling after failure.
  return Promise.race([
    Promise.all([storePromise, pumpPromise]).then(([store]) => {
      checkAbort(signal);
      return store;
    }),
    failure,
  ])
    .catch(async (cause: unknown) => {
      cancelPump(cause instanceof Error ? cause : new Error(String(cause)));
      await pumpPromise.catch(() => {});
      throw cause;
    })
    .finally(() => signal.removeEventListener("abort", onAbort));
}

/**
 * Parse a media-type header string and return its `type` (no
 * parameters) lowercased. Returns `null` if the header is missing or
 * malformed — useful for `Accept-Patch` probing.
 */
export function extractMediaType(headerValue: string | null): string | null {
  if (!headerValue) return null;
  try {
    return contentType.parse(headerValue).type;
  } catch {
    return null;
  }
}

/** Wire up the parser's `data`/`end`/`error` events so each emitted
 * quad lands directly in a fresh `Store`. */
function collectIntoStore(parser: QuadTransform, options: ParseRdfOptions): Promise<Store> {
  return new Promise<Store>((resolve, reject) => {
    const store = createStore(options);
    parser.on("data", (quad) => {
      store.addQuad(quad);
    });
    parser.on("error", reject);
    parser.on("end", () => {
      resolve(store);
    });
  });
}

function createStore(options: ParseRdfOptions): Store {
  const store = options.storeFactory?.() ?? new Store([], { factory: options.factory });
  if (store.size !== 0) throw new RdfFetchError("Parser store must be empty.");
  return store;
}

/** Feed a string or web `ReadableStream<Uint8Array>` into the parser.
 *
 * Hand-rolled rather than using `node:stream/promises#pipeline` so the
 * module stays runnable in browsers — both `n3.StreamParser` and
 * `JsonLdParser` are `readable-stream` Transforms, which expose
 * `write` / `drain` / `error` / `end` identically in Node and the
 * browser. The two pieces of stream hygiene we still need to do
 * ourselves:
 *
 * 1. **Backpressure** — when `parser.write()` returns `false`, wait
 *    for `'drain'` before reading the next chunk. Otherwise the
 *    parser's internal buffer can grow unbounded and we lose the
 *    streaming benefit.
 * 2. **Teardown on parser error** — if the parser emits `'error'`
 *    mid-stream (e.g. malformed Turtle / JSON-LD), bail out of the
 *    pump loop and `cancel()` the source `ReadableStream` so we stop
 *    pulling bytes off the network instead of draining the rest of
 *    the response. */
async function pumpBody(
  parser: QuadTransform,
  body: RdfBody,
  maxBytes: number,
  signal: AbortSignal,
  checkChunk: ((text: string) => void) | undefined,
  registerCancel: (cancel: (error: Error) => void) => void,
): Promise<void> {
  if (typeof body === "string") {
    checkChunk?.(body);
    parser.end(body);
    return;
  }

  const reader = body.getReader();
  let bytes = 0;
  let parserError: Error | null = null;
  const onParserError = (err: Error) => {
    parserError = err;
    // Wake a pending read even when the source never sends another chunk.
    void reader.cancel(err).catch(() => {});
  };
  registerCancel(onParserError);
  parser.on("error", onParserError);

  try {
    const decoder = new TextDecoder();
    for (;;) {
      if (parserError) throw parserError;
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) break;
      if (value === undefined) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw parseLimit("maxBytes");
      const text = decoder.decode(value, { stream: true });
      if (text.length === 0) continue;
      checkChunk?.(text);
      if (!parser.write(text)) await waitForDrain(parser);
    }
    if (parserError) throw parserError;
    const tail = decoder.decode();
    checkChunk?.(tail);
    if (tail.length > 0) parser.write(tail);
    parser.end();
  } catch (err) {
    parser.destroy(err instanceof Error ? err : new Error(String(err)));
    // Best-effort: abort the source so the network fetch stops too.
    void reader.cancel().catch(() => {});
    throw err;
  } finally {
    parser.off("error", onParserError);
    reader.releaseLock();
  }
}

/** Resolve when the parser drains, reject if it errors first. */
function waitForDrain(parser: QuadTransform): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      parser.off("drain", onDrain);
      parser.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    parser.once("drain", onDrain);
    parser.once("error", onError);
  });
}
