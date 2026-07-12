// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Multibase base58btc (`z`-prefixed) encode/decode for Data Integrity
// `proofValue`s. W3C Data Integrity encodes signature octets as multibase
// base58btc, i.e. a leading `z` followed by the base58btc alphabet. We delegate
// to `multiformats` (the canonical IPFS/W3C multiformats library) — NEVER a
// hand-rolled base58 — so the alphabet, leading-zero handling and the `z` prefix
// are exactly spec, and there is no bespoke radix arithmetic to get subtly wrong.

import { base58btc } from "multiformats/bases/base58";

/**
 * Encode raw signature octets as a multibase base58btc string (leading `z`).
 * `multiformats`' `base58btc.encode` already emits the `z` multibase prefix.
 */
export function base58btcEncode(bytes: Uint8Array): string {
  return base58btc.encode(bytes);
}

/**
 * Decode a multibase base58btc string (leading `z`) back to raw octets. Throws if
 * the string is not `z`-prefixed base58btc — callers in the verify path catch and
 * fail closed (a malformed proofValue is an invalid proof, never a throw upward).
 */
export function base58btcDecode(value: string): Uint8Array {
  return base58btc.decode(value);
}
