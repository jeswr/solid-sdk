// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The §9 SSRF-disciplined PRE-FETCH for <jeswr-shacl-view>. This module owns the
// rule that makes the wrapper safe: shacl-form is NEVER given a URL to fetch
// itself (no data-shapes-url / data-values-url), and owl:imports loading is always
// off (data-ignore-owl-imports is always set by the element). Instead, the wrapper
// fetches the shape + data graphs HERE, through the right fetch for the source, and
// hands shacl-form INLINE Turtle strings.
//
// THE THREE FETCH MODES, in increasing trust:
//   1. inline string  — the caller already has the Turtle/JSON-LD text. No fetch.
//   2. same-trust URL  — fetched with the injected auth seam (`fetch` for the
//      user's own origin, `publicFetch` for a public/foreign read). These are the
//      app's own trusted fetches; the app chose the URL.
//   3. user-configured REMOTE URL — fetched through @jeswr/guarded-fetch (https
//      only, blocks private/loopback/link-local/metadata, size cap + timeout, no
//      auto-redirect to a different origin with credentials). This is the
//      untrusted-source path: a shape/data URL that came from user input or an
//      untrusted document. guarded-fetch is loaded by DYNAMIC import so it stays
//      out of the base bundle (the optional-dependency contract).
//
// In every mode the result is parsed by @jeswr/fetch-rdf's `parseRdf` (canonical,
// never a hand-rolled parser) and re-serialised to a Turtle string by `n3.Writer`
// before it reaches shacl-form. So shacl-form only ever sees inline Turtle text it
// did not fetch — there is no path by which shacl-form issues a network request.

import { parseToStore } from "./rdf.js";
import { serializeTurtle } from "./serialize.js";

/** A graph source for the view: an already-in-hand string, or a URL to pre-fetch. */
export type GraphSource =
  | { readonly kind: "inline"; readonly text: string; readonly contentType?: string }
  | {
      /**
       * A URL the APP trusts (it chose it). Fetched with the injected seam:
       * `auth` ⇒ the session-bound fetch; `public` ⇒ the credential-free fetch.
       */
      readonly kind: "trusted";
      readonly url: string;
      readonly seam: "auth" | "public";
    }
  | {
      /**
       * A user-configured / untrusted REMOTE URL. Fetched ONLY through
       * @jeswr/guarded-fetch (https-only, SSRF-blocked, capped + timed out).
       */
      readonly kind: "remote";
      readonly url: string;
    };

/**
 * The app fetches the resolver may use for a `trusted` source.
 *
 * `publicFetch` is OPTIONAL and has NO fallback: a `{ seam: "public" }` source is
 * FAIL-CLOSED — if `publicFetch` is not provided, the resolver throws rather than
 * silently using `fetch` (which is the authenticated, possibly DPoP-bound session
 * fetch). This is the credential boundary: a public/foreign read must never carry
 * the session token just because a credential-free fetch was not supplied. There
 * is deliberately no "pristine global" default here — by the time a component
 * resolves, `globalThis.fetch` may already have been patched by auth code, so it
 * cannot be trusted as credential-free; the caller must pass an explicit one.
 */
export interface FetchSeam {
  readonly fetch: typeof fetch;
  readonly publicFetch?: typeof fetch;
}

/** Options for {@link resolveGraphToTurtle}. */
export interface ResolveOptions {
  /** Abort signal threaded into whichever fetch runs. */
  readonly signal?: AbortSignal;
  /**
   * Override the guarded-fetch loader (tests inject a stub so they neither hit the
   * network nor bundle undici). Production omits it → the real dynamic import.
   */
  readonly loadGuardedFetch?: () => Promise<typeof fetch>;
  /** Max bytes for a `remote` fetch (passed to guarded-fetch). Default 2 MiB. */
  readonly maxBytes?: number;
  /** Timeout (ms) for a `remote` fetch (passed to guarded-fetch). Default 10s. */
  readonly timeoutMs?: number;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9";

/**
 * Resolve a {@link GraphSource} to a Turtle STRING ready to inline into
 * shacl-form. The ONLY fetch a `remote` source can use is the guarded one; a
 * `trusted` source uses the app's own seam; an `inline` source is parsed + re-
 * serialised (to normalise + validate) but never fetched.
 *
 * @throws on a parse failure or a guard rejection (the element renders the error).
 */
export async function resolveGraphToTurtle(
  source: GraphSource,
  seam: FetchSeam,
  options: ResolveOptions = {},
): Promise<string> {
  if (source.kind === "inline") {
    // Re-parse + re-serialise so what reaches shacl-form is normalised Turtle from
    // the canonical parser, not an arbitrary string. (Also catches malformed input
    // up front rather than inside shacl-form.)
    const store = await parseToStore(source.text, source.contentType ?? "text/turtle");
    return serializeTurtle(store);
  }

  if (source.kind === "trusted") {
    let doFetch: typeof fetch;
    if (source.seam === "public") {
      // FAIL-CLOSED credential boundary: a public source REQUIRES an explicit
      // credential-free fetch. We never fall back to `seam.fetch` (authenticated)
      // or to a possibly-patched `globalThis.fetch`.
      if (!seam.publicFetch) {
        throw new Error(
          `Refusing to fetch trusted public source ${source.url}: no credential-free ` +
            "`publicFetch` was provided. Set the element's `.publicFetch` (a fetch that " +
            "carries no session credentials) to read a public/foreign source.",
        );
      }
      doFetch = seam.publicFetch;
    } else {
      doFetch = seam.fetch;
    }
    // Trusted (app-chosen) URLs may negotiate JSON-LD — the app vouches for them.
    return fetchAndSerialise(source.url, doFetch, { signal: options.signal, turtleOnly: false });
  }

  // source.kind === "remote" — the untrusted path. NEVER the app seam, ALWAYS the
  // SSRF guard. The guard itself is dynamically imported so it (and undici on
  // Node) stays out of the base bundle. TURTLE-ONLY: a JSON-LD document's remote
  // `@context` can trigger a SECOND, UNGUARDED network fetch inside the JSON-LD
  // parser — that would defeat the SSRF guard. Turtle has no remote-fetch surface,
  // so for an untrusted source we ask for Turtle only and REJECT a JSON-LD body.
  const guarded = await loadGuarded(options);
  return fetchAndSerialise(source.url, guarded, {
    signal: options.signal,
    turtleOnly: true,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}

/** Media types whose parsing never triggers a further network fetch (no @context). */
const NO_NETWORK_RDF_TYPES = new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
]);

interface FetchAndSerialiseOptions {
  readonly signal?: AbortSignal;
  /** When true (untrusted/remote), accept Turtle only + reject a JSON-LD body. */
  readonly turtleOnly: boolean;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

/** Fetch a URL with the given fetch, parse + re-serialise to Turtle. */
async function fetchAndSerialise(
  url: string,
  doFetch: typeof fetch,
  opts: FetchAndSerialiseOptions,
): Promise<string> {
  const response = await doFetch(url, {
    method: "GET",
    // For an untrusted source ask for Turtle ONLY (no JSON-LD remote-@context surface).
    headers: { Accept: opts.turtleOnly ? "text/turtle" : RDF_ACCEPT },
    ...(opts.signal ? { signal: opts.signal } : {}),
    // These two are honoured by the guarded fetch (a plain fetch ignores unknown
    // init keys); the guard reads them from its own GuardOptions, but we also pass
    // them on the init so a guarded-fetch built per-call picks them up.
    ...(opts.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  } as RequestInit);
  if (!response.ok) {
    throw new Error(`Failed to fetch graph ${url}: HTTP ${response.status}`);
  }
  const contentType = response.headers.get("Content-Type");
  // SSRF defence for untrusted sources: a JSON-LD body could pull a remote
  // @context through an UNGUARDED parser fetch. We asked for Turtle only; if the
  // server replied with anything that is not a no-network RDF type, refuse it.
  if (opts.turtleOnly) {
    const mediaType = (contentType ?? "text/turtle").split(";")[0].trim().toLowerCase();
    if (!NO_NETWORK_RDF_TYPES.has(mediaType)) {
      throw new Error(
        `Refusing untrusted remote graph ${url}: content-type "${mediaType}" is not a ` +
          "no-network RDF type (Turtle/N-Triples/N-Quads/TriG). JSON-LD/RDF-XML are " +
          "rejected for remote sources to avoid an unguarded remote-context/import fetch.",
      );
    }
  }
  // Parse against the FINAL URL after any redirects so relative IRIs in the
  // shapes/data resolve correctly (mirrors DataController.read).
  const finalUrl = response.url || url;
  const body = response.body ?? (await response.text());
  const store = await parseToStore(body, contentType, { baseIRI: finalUrl });
  return serializeTurtle(store);
}

/**
 * Build the guarded fetch for a `remote` source. Uses the injected loader in
 * tests; in production dynamically imports `@jeswr/guarded-fetch` and constructs a
 * browser-safe guarded fetch (https-only, private/loopback/metadata blocked, no
 * auto-redirect across origins with credentials). The dynamic import keeps the
 * guard + undici out of the base bundle.
 */
async function loadGuarded(options: ResolveOptions): Promise<typeof fetch> {
  if (options.loadGuardedFetch) return options.loadGuardedFetch();
  const mod = (await import("@jeswr/guarded-fetch")) as {
    createGuardedFetch: (opts?: { maxBytes?: number; timeoutMs?: number }) => typeof fetch;
  };
  return mod.createGuardedFetch({
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}
