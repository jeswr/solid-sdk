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
import { refusingDocumentLoader } from "./document-loader.js";
import { RdfFetchError } from "./errors.js";
import type { ParseRdfOptions, RdfMediaType } from "./types.js";

/** Media types this dispatch helper recognises. Anything else triggers
 * an {@link RdfFetchError} rather than a silent best-effort parse. */
export const SUPPORTED_RDF_MEDIA_TYPES = [
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/ld+json",
] as const;

/** The set of media types routed to the n3 parser. */
const N3_FAMILY = new Set<string>([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
]);

/** The set of media types routed to the JSON-LD streaming parser. */
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

  if (options.engine && (N3_FAMILY.has(mediaType) || JSON_LD_FAMILY.has(mediaType))) {
    try {
      const input = typeof body === "string" ? body : await bufferBody(body);
      return await options.engine.parse(input, mediaType as RdfMediaType, {
        ...(baseIRI !== undefined && { baseIri: baseIRI }),
      });
    } catch (cause) {
      throw new RdfFetchError(
        `Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`,
        { cause, contentType: rawHeader, ...(baseIRI !== undefined && { url: baseIRI }) },
      );
    }
  }

  let parser: QuadTransform;
  if (N3_FAMILY.has(mediaType)) {
    if (typeof body === "string") {
      try {
        // A stream's `end` event needs a later event-loop turn in Node/jsdom.
        // Buffered input previously settled during a consumer's microtask flush.
        return new Store(
          new Parser({ format: mediaType, ...(baseIRI !== undefined && { baseIRI }) }).parse(body),
        );
      } catch (cause) {
        throw new RdfFetchError(
          `Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`,
          { cause, contentType: rawHeader, ...(baseIRI !== undefined && { url: baseIRI }) },
        );
      }
    }
    parser = new StreamParser({
      format: mediaType,
      ...(baseIRI !== undefined && { baseIRI }),
    }) as unknown as QuadTransform;
  } else if (JSON_LD_FAMILY.has(mediaType)) {
    parser = new JsonLdParser({
      ...(baseIRI !== undefined && { baseIRI }),
      documentLoader: options.documentLoader ?? refusingDocumentLoader,
    }) as unknown as QuadTransform;
  } else {
    throw new RdfFetchError(
      `Unsupported RDF media type: "${mediaType}". Supported: ${SUPPORTED_RDF_MEDIA_TYPES.join(", ")}.`,
      { contentType: rawHeader, ...(baseIRI !== undefined && { url: baseIRI }) },
    );
  }

  const storePromise = collectIntoStore(parser);
  const pumpPromise = pumpBody(parser, body).catch((cause: unknown) => {
    // Includes synchronous failures such as acquiring an already-locked body.
    parser.destroy(cause instanceof Error ? cause : new Error(String(cause)));
    throw cause;
  });
  // Observe both immediately: either side can fail while the other is pending.
  const [storeResult, pumpResult] = await Promise.allSettled([storePromise, pumpPromise]);
  try {
    if (pumpResult.status === "rejected") throw pumpResult.reason;
    if (storeResult.status === "rejected") throw storeResult.reason;
    return storeResult.value;
  } catch (cause) {
    if (cause instanceof RdfFetchError) throw cause;
    throw new RdfFetchError(
      `Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`,
      { cause, contentType: rawHeader, ...(baseIRI !== undefined && { url: baseIRI }) },
    );
  }
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
function collectIntoStore(parser: QuadTransform): Promise<Store> {
  return new Promise<Store>((resolve, reject) => {
    const store = new Store();
    parser.on("data", (quad) => {
      store.addQuad(quad);
    });
    parser.on("error", reject);
    parser.on("end", () => {
      resolve(store);
    });
  });
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
async function pumpBody(parser: QuadTransform, body: RdfBody): Promise<void> {
  if (typeof body === "string") {
    parser.end(body);
    return;
  }

  const reader = body.getReader();
  let parserError: Error | null = null;
  const onParserError = (err: Error) => {
    parserError = err;
    // Wake a pending read even when the source never sends another chunk.
    void reader.cancel(err).catch(() => {});
  };
  parser.on("error", onParserError);

  try {
    const decoder = new TextDecoder();
    for (;;) {
      if (parserError) throw parserError;
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      const text = decoder.decode(value, { stream: true });
      if (text.length === 0) continue;
      if (!parser.write(text)) await waitForDrain(parser);
    }
    if (parserError) throw parserError;
    const tail = decoder.decode();
    if (tail.length > 0) parser.write(tail);
    parser.end();
  } catch (err) {
    parser.destroy(err instanceof Error ? err : new Error(String(err)));
    // Best-effort: abort the source so the network fetch stops too.
    try {
      await reader.cancel();
    } catch {
      // The reader may already be released or the stream already
      // errored; we're throwing anyway, so swallow.
    }
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

/** Engine parsing accepts buffered input; release the source on every exit path. */
async function bufferBody(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (cause) {
    try {
      await reader.cancel(cause);
    } catch {
      // Keep the original stream failure.
    }
    throw cause;
  } finally {
    reader.releaseLock();
  }
}
