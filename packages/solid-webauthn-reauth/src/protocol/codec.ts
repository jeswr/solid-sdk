// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md

/**
 * Codec for the assertion bundle carried as the token-exchange `subject_token`.
 * Base64url of the UTF-8 JSON envelope.
 *
 * The decode path is a **security surface**: an IdP verifier calls
 * {@link decodeAssertionBundle} on the untrusted `subject_token` before any
 * crypto. It is deliberately fail-closed and structural-only — cryptographic
 * verification of the inner WebAuthn assertion is the verifier's job.
 */

import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { BUNDLE_VERSION } from "./constants.js";
import type { AssertionBundle } from "./types.js";

/** Error thrown when a presented assertion bundle cannot be decoded/validated. */
export class MalformedBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedBundleError";
  }
}

/** Encode an assertion bundle to its on-the-wire `subject_token` form. */
export function encodeAssertionBundle(bundle: AssertionBundle): string {
  return encodeBase64url(JSON.stringify(bundle));
}

/**
 * Decode and validate a `subject_token` into an {@link AssertionBundle}.
 *
 * Validation here is structural only — it guards the parse and the envelope
 * version. Cryptographic verification of the inner WebAuthn assertion is the
 * verifier's job.
 *
 * @throws {MalformedBundleError} on bad base64url, non-JSON, wrong shape, or an
 *   unknown `version` (maps to `invalid_request`).
 */
export function decodeAssertionBundle(token: string): AssertionBundle {
  let json: string;
  try {
    json = decodeBase64url(token);
  } catch {
    throw new MalformedBundleError("subject_token is not valid base64url");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new MalformedBundleError("subject_token is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new MalformedBundleError("assertion bundle must be an object");
  }

  const bundle = parsed as Record<string, unknown>;

  if (bundle.version !== BUNDLE_VERSION) {
    throw new MalformedBundleError(
      `unsupported assertion bundle version: ${String(bundle.version)}`,
    );
  }

  if (typeof bundle.credential !== "object" || bundle.credential === null) {
    throw new MalformedBundleError("assertion bundle is missing `credential`");
  }

  // Structurally validate the inner AuthenticatorAssertionResponseJSON. Without
  // this the bundle would be returned `as unknown` and fail safe only via a
  // downstream crypto catch; validate the shape here so a malformed credential
  // is a clean `invalid_request`, not a deeper exception. We check
  // presence/type of the fields the verifier reads — not their contents (the
  // signature re-authenticates the bytes).
  validateAssertionCredential(bundle.credential as Record<string, unknown>);

  return bundle as unknown as AssertionBundle;
}

/** Unpadded base64url alphabet (the WebAuthn JSON serialization, §5.8.1). */
const BASE64URL = /^[A-Za-z0-9_-]+$/u;

/** Assert a string field is present and non-empty on `obj`, else throw. */
function requireString(obj: Record<string, unknown>, field: string): void {
  const value = obj[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new MalformedBundleError(`assertion bundle credential is missing string \`${field}\``);
  }
}

/** Assert a field is a non-empty base64url string (no padding), else throw. */
function requireBase64url(obj: Record<string, unknown>, field: string): void {
  requireString(obj, field);
  if (!BASE64URL.test(obj[field] as string)) {
    throw new MalformedBundleError(`assertion bundle credential \`${field}\` is not base64url`);
  }
}

/**
 * Validate the inner `AuthenticatorAssertionResponseJSON` envelope: a base64url
 * `id`/`rawId`, `type === "public-key"`, and a `response` object carrying the
 * base64url `clientDataJSON`, `authenticatorData`, and `signature` the verifier
 * needs. `userHandle` is optional (absent for non-resident credentials).
 */
function validateAssertionCredential(credential: Record<string, unknown>): void {
  requireBase64url(credential, "id");
  requireBase64url(credential, "rawId");
  if (credential.type !== "public-key") {
    throw new MalformedBundleError('assertion bundle credential.type must be "public-key"');
  }
  const response = credential.response;
  if (typeof response !== "object" || response === null) {
    throw new MalformedBundleError("assertion bundle credential is missing `response`");
  }
  const r = response as Record<string, unknown>;
  requireBase64url(r, "clientDataJSON");
  requireBase64url(r, "authenticatorData");
  requireBase64url(r, "signature");
  if (r.userHandle !== undefined && r.userHandle !== null && typeof r.userHandle !== "string") {
    throw new MalformedBundleError(
      "assertion bundle credential.response.userHandle must be a string when present",
    );
  }
}
