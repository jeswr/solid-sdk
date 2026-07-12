// AUTHORED-BY Claude Fable 5
//
// The W3C Bitstring Status List v1.0 bitstring: a compressed bit array where
// each credential's `statusListIndex` names ONE bit, and a set bit means the
// status (revoked / suspended, per the list's `statusPurpose`) applies.
//
// Encoding, per the spec (§ Bitstring Encoding):
//   raw bitstring (MSB-first: index 0 = the LEFTMOST bit of byte 0, matching
//   the spec's left-to-right bit order and the reference implementation)
//   → GZIP → base64url (no padding) → multibase prefix `u`.
//
// Fail-closed decoding: the decoder REFUSES (throws `BitstringDecodeError`) a
// missing/wrong multibase prefix, a non-base64url character, a body that is
// not valid GZIP, an expanded list smaller than the spec's 16KB minimum
// (herd-privacy MUST), and — the zip-bomb guard — an expansion larger than
// `maxDecodedBytes` (default 16 MiB ≈ 134M entries). A status list that cannot
// be decoded must never read as "not revoked".

import { gunzipSync, gzipSync } from "node:zlib";

/**
 * The spec's minimum bitstring length in BITS: 131,072 entries = 16KB
 * uncompressed ("the uncompressed bitstring MUST be at least 16KB in size" —
 * a herd-privacy floor, so one credential's status is not individually
 * addressable by list size).
 */
export const MIN_STATUS_LIST_LENGTH = 131072;

/** The default zip-bomb ceiling on the DECODED bitstring: 16 MiB (2^27 bits). */
export const DEFAULT_MAX_DECODED_BYTES = 16 * 1024 * 1024;

/** A structured, catchable bitstring decode failure (always fail-closed). */
export class BitstringDecodeError extends Error {
  constructor(message: string) {
    super(`@jeswr/solid-vc: ${message}`);
    this.name = "BitstringDecodeError";
  }
}

/**
 * Create a zeroed status bitstring of `length` bits (default — and minimum —
 * the spec's 131,072 entries / 16KB). Throws on a length below the spec
 * minimum or not a multiple of 8 (a partial trailing byte has no spec'd
 * encoding).
 */
export function createStatusBitstring(length: number = MIN_STATUS_LIST_LENGTH): Uint8Array {
  if (!Number.isInteger(length) || length < MIN_STATUS_LIST_LENGTH) {
    throw new RangeError(
      `@jeswr/solid-vc: a status bitstring must be at least ${MIN_STATUS_LIST_LENGTH} bits ` +
        `(the spec's 16KB herd-privacy minimum), got ${length}`,
    );
  }
  if (length % 8 !== 0) {
    throw new RangeError(
      `@jeswr/solid-vc: a status bitstring length must be a multiple of 8, got ${length}`,
    );
  }
  return new Uint8Array(length / 8);
}

/** Bounds-check an index against a bitstring, throwing a RangeError outside it. */
function checkIndex(bits: Uint8Array, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= bits.length * 8) {
    throw new RangeError(
      `@jeswr/solid-vc: statusListIndex ${index} is outside the bitstring (0..${
        bits.length * 8 - 1
      })`,
    );
  }
}

/**
 * Read the bit at `index` (spec bit order: index 0 is the MOST SIGNIFICANT bit
 * of byte 0). Throws a RangeError on an out-of-range index — the caller must
 * treat that as a verification failure, never as "bit clear".
 */
export function getStatusBit(bits: Uint8Array, index: number): boolean {
  checkIndex(bits, index);
  const byte = bits[index >> 3] as number;
  return (byte & (0x80 >> (index & 7))) !== 0;
}

/**
 * Set (`value: true` — revoke/suspend) or clear (`value: false` — reinstate)
 * the bit at `index`, in place. Same MSB-first bit order and bounds check as
 * {@link getStatusBit}.
 */
export function setStatusBit(bits: Uint8Array, index: number, value: boolean): void {
  checkIndex(bits, index);
  const mask = 0x80 >> (index & 7);
  if (value) {
    bits[index >> 3] = (bits[index >> 3] as number) | mask;
  } else {
    bits[index >> 3] = (bits[index >> 3] as number) & ~mask;
  }
}

/** The base64url alphabet (no padding) — validated BEFORE decoding, because
 * `Buffer.from(s, "base64url")` silently SKIPS invalid characters (lenient),
 * and a lenient decode of a corrupted list must not "succeed". */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Encode a raw status bitstring to the spec's `encodedList` form:
 * GZIP → base64url (unpadded) → multibase prefix `u`.
 */
export function encodeStatusList(bits: Uint8Array): string {
  const compressed = gzipSync(bits);
  return `u${Buffer.from(compressed).toString("base64url")}`;
}

/**
 * Decode an `encodedList` value back to the raw bitstring, FAIL-CLOSED: any
 * anomaly throws {@link BitstringDecodeError}. Enforced invariants:
 *
 *  - multibase prefix MUST be `u` (base64url, the only encoding the spec uses);
 *  - the payload MUST be strictly base64url (a lenient decode is refused);
 *  - the payload MUST be valid GZIP;
 *  - the expanded bitstring MUST be at least the spec's 16KB minimum;
 *  - the expansion MUST NOT exceed `maxDecodedBytes` (zip-bomb guard,
 *    default {@link DEFAULT_MAX_DECODED_BYTES}).
 */
export function decodeStatusList(
  encoded: string,
  options?: { readonly maxDecodedBytes?: number },
): Uint8Array {
  const maxDecodedBytes = options?.maxDecodedBytes ?? DEFAULT_MAX_DECODED_BYTES;
  if (typeof encoded !== "string" || encoded.length < 2) {
    throw new BitstringDecodeError("encodedList is not a non-empty string");
  }
  if (!encoded.startsWith("u")) {
    throw new BitstringDecodeError(
      `encodedList must carry the multibase base64url prefix "u", got "${encoded.slice(0, 1)}"`,
    );
  }
  const payload = encoded.slice(1);
  if (!BASE64URL.test(payload)) {
    throw new BitstringDecodeError("encodedList payload is not valid base64url");
  }
  const compressed = Buffer.from(payload, "base64url");
  let bits: Buffer;
  try {
    bits = gunzipSync(compressed, { maxOutputLength: maxDecodedBytes });
  } catch (e) {
    throw new BitstringDecodeError(
      `encodedList did not decompress as GZIP within ${maxDecodedBytes} bytes: ${
        (e as Error).message
      }`,
    );
  }
  if (bits.length * 8 < MIN_STATUS_LIST_LENGTH) {
    throw new BitstringDecodeError(
      `decoded bitstring is ${bits.length * 8} bits — below the spec's ` +
        `${MIN_STATUS_LIST_LENGTH}-bit (16KB) minimum`,
    );
  }
  return new Uint8Array(bits.buffer, bits.byteOffset, bits.byteLength);
}
