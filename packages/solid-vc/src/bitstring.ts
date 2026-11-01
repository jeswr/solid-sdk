// AUTHORED-BY Codex GPT-6.1-Sol
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

import { Gunzip, gzipSync } from "fflate";

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

/** The base64url alphabet (no padding), validated BEFORE decoding. */
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64urlEncode(bytes: Uint8Array): string {
  let result = "";
  let value = 0;
  let count = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    count += 8;
    while (count >= 6) {
      count -= 6;
      result += ALPHABET[(value >>> count) & 63];
    }
  }
  if (count) result += ALPHABET[(value << (6 - count)) & 63];
  return result;
}

function base64urlDecode(payload: string): Uint8Array {
  const out = new Uint8Array(Math.floor((payload.length * 6) / 8));
  let value = 0;
  let count = 0;
  let offset = 0;
  for (const char of payload) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new BitstringDecodeError("encodedList payload is not valid base64url");
    value = (value << 6) | digit;
    count += 6;
    if (count >= 8) {
      count -= 8;
      out[offset++] = (value >>> count) & 255;
    }
  }
  // Reject impossible lengths and nonzero unused bits (noncanonical aliases).
  if (payload.length % 4 === 1 || (value & ((1 << count) - 1)) !== 0)
    throw new BitstringDecodeError("encodedList payload is not valid base64url");
  return out;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  let value = crc;
  for (const byte of bytes) value = (value >>> 8) ^ (CRC_TABLE[(value ^ byte) & 255] as number);
  return value;
}

/** fflate inflates members but does not validate their headers' CRCs or trailers. */
function validateMember(bytes: Uint8Array, start: number, end: number, crc: number, size: number) {
  const invalid = () => {
    throw new Error("invalid or truncated GZIP member");
  };
  if (
    end - start < 18 ||
    bytes[start] !== 31 ||
    bytes[start + 1] !== 139 ||
    bytes[start + 2] !== 8 ||
    ((bytes[start + 3] as number) & 0xe0) !== 0
  )
    invalid();
  const flags = bytes[start + 3] as number;
  const footer = end - 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = start + 10;
  if (flags & 4) {
    if (pos + 2 > footer) invalid();
    pos += 2 + view.getUint16(pos, true);
  }
  for (const flag of [8, 16]) {
    if (flags & flag) {
      while (pos < footer && bytes[pos] !== 0) pos++;
      pos++;
    }
  }
  if (flags & 2) {
    if (pos + 2 > footer) invalid();
    if (((crc32(bytes.subarray(start, pos)) ^ 0xffffffff) & 0xffff) !== view.getUint16(pos, true))
      invalid();
    pos += 2;
  }
  if (
    pos >= footer ||
    (crc ^ 0xffffffff) >>> 0 !== view.getUint32(footer, true) ||
    size >>> 0 !== view.getUint32(footer + 4, true)
  )
    invalid();
}

/** A known-complete next member forces Gunzip to expose the preceding member boundary. */
const EMPTY_GZIP = gzipSync(new Uint8Array(0), { mtime: 0 });

/**
 * Encode a raw status bitstring to the spec's `encodedList` form:
 * GZIP → base64url (unpadded) → multibase prefix `u`.
 */
export function encodeStatusList(bits: Uint8Array): string {
  const compressed = gzipSync(bits, { mtime: 0 });
  return `u${base64urlEncode(compressed)}`;
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
  const compressed = base64urlDecode(payload);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes <= 0)
      throw new Error("maxDecodedBytes must be a positive safe integer");
    let crc = 0xffffffff;
    let size = 0;
    let start = 0;
    let complete = false;
    const gunzip = new Gunzip((chunk) => {
      total += chunk.length;
      if (total > maxDecodedBytes) throw new Error("decoded bitstring exceeds maxDecodedBytes");
      chunks.push(chunk);
      crc = crc32(chunk, crc);
      size += chunk.length;
    });
    gunzip.onmember = (end) => {
      validateMember(compressed, start, end, crc, size);
      start = end;
      crc = 0xffffffff;
      size = 0;
      complete = end === compressed.length;
    };
    // Bound each inflation step too: feeding the entire compressed bomb in one
    // push could allocate the full expansion before ondata gets to reject it.
    for (let offset = 0; offset < compressed.length; offset += 256)
      gunzip.push(compressed.subarray(offset, offset + 256), false);
    gunzip.push(EMPTY_GZIP, true);
    if (!complete) throw new Error("incomplete GZIP stream");
  } catch (e) {
    throw new BitstringDecodeError(
      `encodedList did not decompress as GZIP within ${maxDecodedBytes} bytes: ${
        (e as Error).message
      }`,
    );
  }
  if (total * 8 < MIN_STATUS_LIST_LENGTH) {
    throw new BitstringDecodeError(
      `decoded bitstring is ${total * 8} bits — below the spec's ` +
        `${MIN_STATUS_LIST_LENGTH}-bit (16KB) minimum`,
    );
  }
  const bits = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bits.set(chunk, offset);
    offset += chunk.length;
  }
  return bits;
}
