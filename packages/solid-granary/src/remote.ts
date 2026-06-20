// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * OPTIONAL fetch-from-granary helper — GET a granary REST endpoint (e.g.
 * `granary.io`) and return its parsed `format=as2` payload.
 *
 * THIS IS THE ONLY PLACE A USER-CONFIGURED REMOTE URL IS DEREFERENCED, and it is
 * MANDATORY that it go through `@jeswr/guarded-fetch` (the suite's SSRF-safe fetch):
 * https-only, no userinfo, block private / loopback / link-local / cloud-metadata
 * addresses, DNS-pin (the `./node` entry closes the lookup→connect rebinding TOCTOU),
 * cap the response body + time, and DO NOT auto-follow redirects (each hop is
 * re-validated). A granary URL is attacker-influenceable (a user types it), so every
 * one of these defences is required.
 *
 * The returned payload is the untrusted granary JSON — hand it to `ingestGranary`
 * (which hardens every field on the map). This helper does NOT write to any pod.
 */

import type { GranaryAs2 } from "./granary.js";

/** Options for {@link fetchGranary}. */
export interface FetchGranaryOptions {
  /**
   * The SSRF-guarded fetch to use. Defaults to `@jeswr/guarded-fetch`'s strict
   * Node pinning fetch (`nodeGuardedFetch`) — DNS-pinned, https-only, redirect
   * re-validated. Pass your own ONLY if it is itself SSRF-safe; passing a raw
   * `globalThis.fetch` would defeat the guard.
   */
  readonly fetch?: typeof globalThis.fetch;
  /** AbortSignal to cancel the request. */
  readonly signal?: AbortSignal;
  /**
   * Maximum payload size, bytes. Defaults to guarded-fetch's own cap; this is a
   * second, parse-time guard on the decoded JSON length. Default 5 MiB.
   */
  readonly maxBytes?: number;
}

/** Raised when a granary endpoint returns a non-2xx status or an unparseable body. */
export class GranaryFetchError extends Error {
  /** The HTTP status, when a response was received. */
  readonly status?: number;
  /** The requested URL. */
  readonly url: string;
  constructor(message: string, url: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "GranaryFetchError";
    this.url = url;
    this.status = options?.status;
  }
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Resolve the default SSRF-guarded fetch lazily so the `@jeswr/guarded-fetch/node`
 * entry (which imports `undici` / `node:*`) is only loaded when actually used — a
 * caller that supplies its own `fetch`, or only ever uses {@link ingestGranary},
 * never pulls in the Node networking stack.
 */
async function defaultGuardedFetch(): Promise<typeof globalThis.fetch> {
  const { nodeGuardedFetch } = await import("@jeswr/guarded-fetch/node");
  return nodeGuardedFetch;
}

/**
 * GET a granary `format=as2` endpoint through the SSRF guard and return the parsed
 * payload (a single AS2 object or an AS2 Collection). Throws {@link
 * GranaryFetchError} on a non-2xx status, an over-cap body, or unparseable JSON; the
 * guard throws its own `SsrfError`/`GuardError` for a blocked URL.
 *
 * The URL is validated + DNS-pinned by `@jeswr/guarded-fetch`; this helper appends
 * `Accept: application/activity+json, application/ld+json, application/json` so a
 * compliant granary endpoint returns AS2 JSON. It does NOT write to a pod — pass the
 * result to {@link ingestGranary}.
 *
 * @param url - the granary endpoint URL (must be https; attacker-influenceable).
 */
export async function fetchGranary(
  url: string,
  options: FetchGranaryOptions = {},
): Promise<GranaryAs2> {
  const { signal, maxBytes = DEFAULT_MAX_BYTES } = options;
  const guarded = options.fetch ?? (await defaultGuardedFetch());

  let res: Response;
  try {
    res = await guarded(url, {
      method: "GET",
      headers: {
        accept: "application/activity+json, application/ld+json, application/json",
      },
      signal,
    });
  } catch (err) {
    // Re-throw SSRF/guard refusals untouched (they are the security signal); wrap a
    // plain network error so callers get one error type to branch on.
    if (err instanceof GranaryFetchError) throw err;
    throw new GranaryFetchError(`granary fetch failed: ${url}`, url, { cause: err });
  }

  if (res.status < 200 || res.status >= 300) {
    throw new GranaryFetchError(`granary endpoint returned ${res.status}`, url, {
      status: res.status,
    });
  }

  const text = await res.text();
  // Count ENCODED UTF-8 bytes, not UTF-16 code units (`text.length`): a multi-byte
  // payload could otherwise slip past a byte-named cap.
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new GranaryFetchError(`granary payload exceeds ${maxBytes} bytes`, url, {
      status: res.status,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new GranaryFetchError(`granary payload is not valid JSON: ${url}`, url, {
      status: res.status,
      cause: err,
    });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new GranaryFetchError(`granary payload is not an AS2 object/collection: ${url}`, url, {
      status: res.status,
    });
  }
  return parsed as GranaryAs2;
}
