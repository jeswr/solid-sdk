// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md

/**
 * Wire-format types for Solid WebAuthn re-authentication.
 *
 * The WebAuthn JSON shapes are **reused** from the W3C WebAuthn JSON
 * serialization as exposed by SimpleWebAuthn. We import the type definitions
 * from `@simplewebauthn/browser` as **type-only** imports — it re-exports the
 * identical JSON types as `@simplewebauthn/server`, carries no Node crypto
 * dependencies, and (being type-only here) is erased at build so the CJS build
 * of this protocol layer has zero runtime dependency on it.
 */
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";

import type { BUNDLE_VERSION } from "./constants.js";

/** Options the OP sends to start a registration ceremony (`create()`). */
export type RegistrationOptions = PublicKeyCredentialCreationOptionsJSON;

/** Options the OP sends to start an assertion ceremony (`get()`). */
export type AssertionOptions = PublicKeyCredentialRequestOptionsJSON;

/**
 * Registration request body: the WebAuthn registration response plus the
 * Client ID Document URI the app authenticates as.
 */
export interface RegistrationBundle {
  version: typeof BUNDLE_VERSION;
  credential: RegistrationResponseJSON;
  clientId: string;
}

/**
 * The re-auth `subject_token` payload: a versioned envelope around the WebAuthn
 * authentication response. Base64url-encoded on the wire (see codec).
 */
export interface AssertionBundle {
  version: typeof BUNDLE_VERSION;
  credential: AuthenticationResponseJSON;
}

export type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
};
