// AUTHORED-BY Claude Sonnet 5.5
import type { ReadResult } from "@jeswr/storage-client";
import { fail } from "./errors.js";
import type { SerializedDescription } from "./types.js";

const encoder = new TextEncoder();

/** RDF media types a description document may be stored as (and listings treat as candidates). */
export const DESCRIPTION_TYPES: ReadonlySet<string> = new Set([
  "text/turtle",
  "application/ld+json",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "text/n3",
  "application/rdf+xml",
]);

export const DESCRIPTION_ACCEPT = "text/turtle, application/ld+json;q=0.9";

/** The bare media type: lowercase, parameters dropped. */
export function baseType(contentType: string): string {
  return (contentType.split(";")[0] as string).trim().toLowerCase();
}

export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Caller bytes as the store holds them: the ORIGINAL body (a `Blob` is never converted, so the
 * transport can stream it), its size, and only the leading bytes the sniffer needs.
 */
export interface Source {
  readonly body: Blob | Uint8Array;
  readonly size: number;
  readonly head: Uint8Array;
}

/**
 * Check the size cap before reading anything, then read just the first `headBytes` bytes. A
 * `Blob` is sliced, not copied whole; a `Uint8Array` is already in memory and is only viewed.
 */
export async function loadSource(
  body: Blob | Uint8Array,
  max: number,
  headBytes: number,
): Promise<Source> {
  if (body instanceof Uint8Array) {
    if (body.byteLength > max) throw fail("too-large", "bytes-too-large");
    return { body, size: body.byteLength, head: body.subarray(0, headBytes) };
  }
  if (!(body instanceof Blob)) throw fail("failed", "invalid-input");
  if (body.size > max) throw fail("too-large", "bytes-too-large");
  return {
    body,
    size: body.size,
    head: new Uint8Array(await body.slice(0, headBytes).arrayBuffer()),
  };
}

/**
 * SHA-256 of the whole body. WebCrypto has no streaming digest, so a `Blob` is read into ONE
 * transient buffer that is released as soon as the digest resolves; nothing else is retained.
 */
export async function sha256Source(source: Source): Promise<string> {
  return sha256Hex(
    source.body instanceof Uint8Array ? source.body : await source.body.arrayBuffer(),
  );
}

/** Read a response body fully, refusing (and cancelling) as soon as it exceeds `max` bytes. */
export async function readBounded(
  result: Pick<ReadResult, "body">,
  max: number,
  tooLarge: () => Error,
): Promise<Uint8Array> {
  if (result.body === null) return new Uint8Array();
  const reader = result.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await Promise.allSettled([reader.cancel()]);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Normalise `build`/`mutate` output; a description must be one of the RDF media types. */
export function normaliseDescription(
  output: SerializedDescription,
  maxBytes: number,
): { body: string; contentType: string } {
  const body = typeof output === "string" ? output : output.body;
  const contentType = typeof output === "string" ? "text/turtle" : baseType(output.contentType);
  if (typeof body !== "string" || !DESCRIPTION_TYPES.has(contentType)) {
    throw fail("failed", "description-invalid");
  }
  if (encoder.encode(body).byteLength > maxBytes) throw fail("too-large", "description-too-large");
  return { body, contentType };
}
