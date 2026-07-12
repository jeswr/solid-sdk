/**
 * Encode raw signature octets as a multibase base58btc string (leading `z`).
 * `multiformats`' `base58btc.encode` already emits the `z` multibase prefix.
 */
export declare function base58btcEncode(bytes: Uint8Array): string;
/**
 * Decode a multibase base58btc string (leading `z`) back to raw octets. Throws if
 * the string is not `z`-prefixed base58btc — callers in the verify path catch and
 * fail closed (a malformed proofValue is an invalid proof, never a throw upward).
 */
export declare function base58btcDecode(value: string): Uint8Array;
//# sourceMappingURL=multibase.d.ts.map