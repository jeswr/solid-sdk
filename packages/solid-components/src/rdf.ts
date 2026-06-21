// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The single boundary onto @jeswr/fetch-rdf's `parseRdf`, plus the body→string
// adapter. Centralised here so every read path parses identically AND so the one
// place we have to bridge the published-fetch-rdf type quirks lives in one file.
//
// Two published-API quirks of @jeswr/fetch-rdf@0.1.0 we normalise here (and have
// flagged for upstream — see the README "Follow-ups"):
//   1. `parseRdf(body, …)` is typed to accept a STRING only (not a
//      ReadableStream), so we always read the response body to text first.
//   2. `parseRdf` is typed to RETURN `DatasetCore` (the structural RDF/JS
//      interface), though the runtime value IS an n3 `Store`. We construct a real
//      n3 `Store` from the returned dataset's quads so callers get the full Store
//      read API (`getQuads`) and the serialiser gets a Store — without an unsafe
//      cast of the upstream return.

import { parseRdf } from "@jeswr/fetch-rdf";
import { Store } from "n3";

/**
 * Parse an RDF body (string OR a fetch Response body stream) into a real n3
 * {@link Store}. A stream body is materialised to text first (the published
 * `parseRdf` accepts a string only). The parsed dataset's quads are copied into a
 * fresh n3 Store so the caller gets the full Store API regardless of fetch-rdf's
 * declared `DatasetCore` return.
 */
export async function parseToStore(
  body: string | ReadableStream<Uint8Array>,
  contentTypeHeader: string | null,
  options?: { baseIRI?: string },
): Promise<Store> {
  const text = typeof body === "string" ? body : await readStreamToText(body);
  const dataset = await parseRdf(text, contentTypeHeader, options);
  // `dataset` is an n3 Store at runtime, but typed `DatasetCore` (iterable of
  // quads). Building a fresh Store from its quads is correct for either and yields
  // the Store read/serialise API the suite uses — no unsafe cast of the upstream
  // value. The DatasetCore type guarantees iterability.
  return new Store([...dataset]);
}

/** Read a web `ReadableStream<Uint8Array>` fully to a UTF-8 string. */
async function readStreamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}
