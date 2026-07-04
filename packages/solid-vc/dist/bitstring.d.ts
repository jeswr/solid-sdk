/**
 * The spec's minimum bitstring length in BITS: 131,072 entries = 16KB
 * uncompressed ("the uncompressed bitstring MUST be at least 16KB in size" —
 * a herd-privacy floor, so one credential's status is not individually
 * addressable by list size).
 */
export declare const MIN_STATUS_LIST_LENGTH = 131072;
/** The default zip-bomb ceiling on the DECODED bitstring: 16 MiB (2^27 bits). */
export declare const DEFAULT_MAX_DECODED_BYTES: number;
/** A structured, catchable bitstring decode failure (always fail-closed). */
export declare class BitstringDecodeError extends Error {
    constructor(message: string);
}
/**
 * Create a zeroed status bitstring of `length` bits (default — and minimum —
 * the spec's 131,072 entries / 16KB). Throws on a length below the spec
 * minimum or not a multiple of 8 (a partial trailing byte has no spec'd
 * encoding).
 */
export declare function createStatusBitstring(length?: number): Uint8Array;
/**
 * Read the bit at `index` (spec bit order: index 0 is the MOST SIGNIFICANT bit
 * of byte 0). Throws a RangeError on an out-of-range index — the caller must
 * treat that as a verification failure, never as "bit clear".
 */
export declare function getStatusBit(bits: Uint8Array, index: number): boolean;
/**
 * Set (`value: true` — revoke/suspend) or clear (`value: false` — reinstate)
 * the bit at `index`, in place. Same MSB-first bit order and bounds check as
 * {@link getStatusBit}.
 */
export declare function setStatusBit(bits: Uint8Array, index: number, value: boolean): void;
/**
 * Encode a raw status bitstring to the spec's `encodedList` form:
 * GZIP → base64url (unpadded) → multibase prefix `u`.
 */
export declare function encodeStatusList(bits: Uint8Array): string;
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
export declare function decodeStatusList(encoded: string, options?: {
    readonly maxDecodedBytes?: number;
}): Uint8Array;
//# sourceMappingURL=bitstring.d.ts.map