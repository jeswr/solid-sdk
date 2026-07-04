// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @jeswr/solid-elements/auth — the CREDENTIAL-BOUNDARY core (SSRF / cleartext guard).
//
// PURE functions (only `URL` — no `fetch`/`globalThis`/DOM state) extracted out of the
// stateful auth controller so the exact set a session's DPoP token may be attached to —
// the security boundary a reviewer most wants to read as a spec — is one small file.
// Exhaustively pinned by `test/auth-origin-boundary.test.ts` (imports through the
// `./index.js` barrel, which re-exports the public functions here unchanged).

import { InvalidWebIdError } from "./errors.js";

/** The loopback hosts `http:` is tolerated on (dev only, under an explicit opt-in). */
export const isLoopback = (host: string): boolean =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";

/** How {@link computeAllowedOrigins} derives the default WebID/issuer origins. */
export interface AllowedOriginsInputs {
  /** Explicit allowed resource origins (any URL; compared by `origin`). */
  allowedOrigins?: string[];
  /** The authenticated WebID (its origin is included unless disabled). */
  webId?: string;
  /** The issuer URL (its origin is included unless disabled). */
  issuer?: string;
  /** Include the WebID's origin. Default true. */
  includeWebIdOrigin?: boolean;
  /** Include the issuer's origin. Default true. */
  includeIssuerOrigin?: boolean;
  /**
   * Allow `http:` origins for LOOPBACK hosts only (dev). Default false: every
   * non-`https:` origin is dropped, so the token is never attached over cleartext.
   */
  allowInsecureLoopback?: boolean;
}

/**
 * The set of resource origins a session token may be attached to — the credential
 * boundary the token provider enforces. PURE + exported so the boundary is
 * unit-tested. CLEARTEXT GUARD: a non-`https:` origin is DROPPED (so a configured
 * `http:` allowedOrigin can't make the DPoP token ride over cleartext), EXCEPT a
 * loopback `http:` origin when `allowInsecureLoopback` is set (dev). Fail-closed: an
 * unparseable entry is skipped; an empty result means the token is attached to NOTHING.
 */
export function computeAllowedOrigins(inputs: AllowedOriginsInputs): ReadonlySet<string> {
  const origins = new Set<string>();
  const add = (value: string | undefined): void => {
    if (!value) return;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return; // unparseable → not allowed (fail-closed)
    }
    if (url.protocol === "https:") {
      origins.add(url.origin);
    } else if (
      url.protocol === "http:" &&
      inputs.allowInsecureLoopback &&
      isLoopback(url.hostname)
    ) {
      origins.add(url.origin); // dev loopback only, under the explicit opt-in
    }
    // every other scheme (incl. non-loopback http) is dropped — no cleartext token
  };
  for (const o of inputs.allowedOrigins ?? []) add(o);
  if (inputs.includeWebIdOrigin !== false) add(inputs.webId);
  if (inputs.includeIssuerOrigin !== false) add(inputs.issuer);
  return origins;
}

/**
 * Whether a request URL targets an allowed origin (the per-request credential
 * gate). PURE + exported. Fail-closed: an unparseable URL is never allowed.
 */
export function isOriginAllowed(allowed: ReadonlySet<string>, requestUrl: string): boolean {
  try {
    return allowed.has(new URL(requestUrl).origin);
  } catch {
    return false;
  }
}

/**
 * The DPoP `htu` claim for a request URL — the request URI WITHOUT its query and
 * fragment (RFC 9449 §4.2). PURE + exported. If the URL is unparseable it is
 * returned unchanged (the proof generator then sees the raw string).
 */
export function htuOf(requestUrl: string): string {
  try {
    const u = new URL(requestUrl);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return requestUrl;
  }
}

/**
 * Validate user input as a WebID: it must parse as a URL and be **`https:`** —
 * because the WebID's origin is added to the credential boundary (the session's
 * DPoP token may be attached to it), so a cleartext `http:` WebID would let the
 * token be sent over plaintext. `http:` is allowed ONLY for a loopback host
 * (`localhost`/`127.0.0.1`/`[::1]`) and ONLY when `allowInsecureLoopback` is set
 * (dev CSS over HTTP) — every other `http:` WebID is rejected.
 */
export function validateWebId(input: string, allowInsecureLoopback = false): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidWebIdError(input, "not a URL");
  }
  if (url.protocol === "https:") return url.toString();
  if (url.protocol === "http:") {
    if (allowInsecureLoopback && isLoopback(url.hostname)) return url.toString();
    throw new InvalidWebIdError(
      input,
      "must be https (http is allowed only for a loopback dev host with allowInsecureLoopback)",
    );
  }
  throw new InvalidWebIdError(input, "scheme must be https");
}
