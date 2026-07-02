// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md

/**
 * Minimal base64url codec working in both Node and the browser. Used by the
 * assertion-bundle codec; kept dependency-free so the shared protocol layer
 * stays light on both sides (client + IdP verifier).
 */

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encode raw bytes as an unpadded base64url string. */
export function bytesToBase64url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode an unpadded base64url string to its raw bytes.
 * @throws if the input contains characters outside the base64url alphabet.
 */
export function base64urlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid base64url: illegal characters");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(base64);
}

/** Encode a UTF-8 string as base64url (no padding). */
export function encodeBase64url(text: string): string {
  return bytesToBase64url(new TextEncoder().encode(text));
}

/**
 * Decode a base64url string to its UTF-8 contents.
 * @throws if the input is not valid base64url or not valid UTF-8.
 */
export function decodeBase64url(token: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(base64urlToBytes(token));
}
