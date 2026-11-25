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
 * What the store keeps of a caller's body: a fresh, immutable `Blob` built from the one buffer
 * that was read (this is what storage-client uploads), its size, the leading bytes for the
 * sniffer and, when asked for, the SHA-256 of exactly those bytes.
 */
export interface Source {
  readonly body: Blob;
  readonly size: number;
  readonly head: Uint8Array;
  readonly sha256: string | undefined;
}

/**
 * Read the caller's body EXACTLY ONCE (a `File` may answer a second read differently, which would
 * break content addressing). Size, sniffing and the digest all come from that one buffer, and
 * the body to upload is a new `Blob` constructed from it, so what is hashed is what is sent and
 * the authenticated fetch can replay it. `Blob.size` is checked before reading; the length of
 * what was actually read is checked again. A `Uint8Array` is not copied for the digest.
 */
export async function loadSource(
  body: Blob | Uint8Array,
  max: number,
  headBytes: number,
  hash: boolean,
): Promise<Source> {
  let buffer: Uint8Array;
  if (body instanceof Uint8Array) {
    buffer = body;
  } else {
    if (!(body instanceof Blob)) throw fail("failed", "invalid-input");
    if (body.size > max) throw fail("too-large", "bytes-too-large");
    buffer = new Uint8Array(await body.arrayBuffer());
  }
  if (buffer.byteLength > max) throw fail("too-large", "bytes-too-large");
  const snapshot = new Blob([buffer as Uint8Array<ArrayBuffer>]);
  return {
    body: snapshot,
    size: buffer.byteLength,
    head: buffer.slice(0, headBytes),
    sha256: hash ? await sha256Hex(buffer) : undefined,
  };
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
