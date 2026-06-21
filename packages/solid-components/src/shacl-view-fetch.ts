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
//   1. inline string  — the caller already has the RDF text. No fetch.
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
//
// NO-NETWORK RDF TYPES ONLY, IN EVERY MODE (§9 fix 4): the canonical parser's
// JSON-LD path (jsonld-streaming-parser) uses a default `FetchDocumentLoader`
// that resolves a remote `@context` IRI via an UNGUARDED `globalThis.fetch`. So a
// JSON-LD / RDF-XML body is REFUSED for ALL three modes — inline, trusted and
// remote — leaving only Turtle/N-Triples/N-Quads/TriG, which have no second-fetch
// surface. (This is uniform; an earlier version guarded only the `remote` mode.)

import type { Quad, Quad_Object } from "n3";
import { parseToStore } from "./rdf.js";
import { serializeTurtle } from "./serialize.js";

// ── §9 shacl-form auto-import hardening ──────────────────────────────────────
//
// `data-ignore-owl-imports` (which the element always sets) closes ONE of
// @ulb-darmstadt/shacl-form's two remote-fetch paths. It does NOT close the
// SECOND: shacl-form's `loadGraphs()` auto-derives a "values subject" from the
// DATA graph (`findConformsToValuesSubject` — any single NamedNode subject
// bearing `dct:conformsTo`, regardless of that quad's OBJECT), and ONLY when the
// loaded SHAPES graph is EMPTY (`countQuads(loaded-shapes) === 0`) it issues an
// UNGUARDED `globalThis.fetch` to every http(s) IRI that subject points at via
// `rdf:type` / `dct:conformsTo` (incl. prefix-expanded IRIs), parsing the body
// into the rendered graph.
//
// THE EMPTY-SHAPES PRECONDITION IS THE WHOLE ATTACK SURFACE. Execution-verified
// against the real upstream `loadGraphs` (test/shacl-view-fetch.test.ts §9
// EXECUTION PROOF + the element tests): with a NON-empty loaded-shapes graph the
// auto-import branch never runs — its `countQuads(loaded-shapes) === 0` guard is
// false — so NO unguarded fetch fires no matter what the data graph contains. So:
//
//   *** fix (1) — FAIL-CLOSED on an empty resolved SHAPES graph — is the SSRF
//       CLOSER. *** The element parses the resolved shapes Turtle and, if it has
//       zero quads, renders the error state and NEVER mounts <shacl-form>, so the
//       `countQuads(loaded-shapes) === 0` precondition can never hold for a mounted
//       form. This single measure closes the auto-import SSRF on its own.
//
// `data-ignore-owl-imports` is unrelated to this branch — it only guards the
// `owl:imports` predicate during `importRDF`.
//
// The values-graph NEUTRALISATION below is a NARROW, defence-in-depth SECOND layer,
// NOT an independent closer (the empty-shapes precondition fix-1 removes is what
// actually closes it):
//
//   (2) NEUTRALISE the untrusted VALUES graph — drop every `dct:conformsTo` quad
//       whose OBJECT is an http(s) IRI. This removes shacl-form's auto-DERIVATION
//       source when ALL conformsTo objects are http(s) (`findConformsToValuesSubject`
//       then finds no subject), and removes the http(s) conformsTo import TARGET.
//
//       We DELIBERATELY DO NOT strip `rdf:type` quads (the earlier build did, and
//       it was a correctness REGRESSION — the High). `rdf:type` is load-bearing for
//       legitimate rendering: shacl-form's view-mode shape-selection
//       (`findRootShaclShapeSubject`) follows the values subject's `rdf:type` to
//       pick the matching `sh:targetClass` node shape. Dropping `rdf:type` makes a
//       benign instance render BLANK (execution-verified). The `rdf:type` strip was
//       also REDUNDANT: fix (1) already closes the SSRF, and stripping `conformsTo`
//       already removes the only auto-DERIVATION source the auto-import needs — once
//       no values subject is derived, the branch reads no `rdf:type` at all.
//
//       We also DO NOT strip `dct:conformsTo` whose object is a NON-http term (e.g.
//       a `urn:` profile reference). A `conformsTo` to a non-fetchable IRI is a
//       legitimate, non-SSRF shape-profile hint that shacl-form uses to DERIVE the
//       values subject so the instance renders against its data (execution-verified:
//       a `conformsTo <urn:…>` + `rdf:type` instance renders non-blank). Stripping
//       it would re-introduce the exact blank-render regression the High flags.
//
//   NOTE — the conformsTo→http strip is NOT independently complete for one edge: a
//   data graph carrying BOTH a (kept) `conformsTo` → non-http AND an `rdf:type` →
//   http on an EMPTY shapes graph would still let upstream fetch the `rdf:type`
//   target, because the non-http conformsTo derives a values subject. That edge is
//   covered by fix (1) (empty shapes never mount), not by (2). This is the
//   "fix 1 is the closer" reconciliation: (2) is belt-and-braces, fix (1) is load-
//   bearing. The §9 EXECUTION PROOF asserts the full closure on the real loader.
//
//   (3) We deliberately do NOT pin a foreign `data-values-subject` sentinel on the
//       element, because shacl-form renders the shape BOUND to that subject, so a
//       sentinel not present in the data would render an EMPTY view (verified
//       against the shacl-form source). The sentinel is exported
//       (`VALUES_SUBJECT_SENTINEL`) for callers who want it on a deliberately-
//       empty/placeholder view. See shacl-view.ts render().
//
// We hard-code the canonical conformsTo IRI (n3 has no bundled vocab constant for
// dct).

/** `http://purl.org/dc/terms/conformsTo`. */
const DCT_CONFORMS_TO = "http://purl.org/dc/terms/conformsTo";

/**
 * The predicate shacl-form's `loadGraphs()` keys its auto-DERIVATION on
 * (`findConformsToValuesSubject`) AND one of the two it follows off the derived
 * subject to FETCH a shape source when the loaded-shapes graph is empty. We strip
 * its http(s)-IRI objects as the narrow defence-in-depth layer; the empty-shapes
 * fail-closed (fix 1) is the actual SSRF closer.
 */
const AUTO_IMPORT_PREDICATES = new Set([DCT_CONFORMS_TO]);

/**
 * Does this object term denote an http(s) IRI shacl-form would fetch? shacl-form
 * accepts both an ABSOLUTE http(s) IRI and a PREFIXED name whose prefix expands to
 * an http(s) IRI; in BOTH cases its classifier is `j()`:
 * `new URL(value).protocol === "http:" || === "https:"` — which is CASE-INSENSITIVE
 * (`new URL("HTTP://…").protocol` normalises to `"http:"`) and tolerant of edge
 * forms (leading/trailing whitespace, mixed-case scheme). A `String.startsWith`
 * check is case-SENSITIVE, so `HTTP://169.254.169.254/…` / `Https://…` would EVADE
 * it while still being fetched by upstream. We therefore MIRROR upstream's `j()`
 * exactly: parse with `new URL` and test the normalised protocol. An un-parseable
 * IRI (one `new URL` rejects) is one upstream's `j()` also rejects → never fetched
 * → not a target, so we leave it in place. A NamedNode object is already absolute
 * (n3 expanded any prefix at parse time); a literal / blank node is never fetched.
 */
function isHttpNamedNode(object: Quad_Object): boolean {
  if (object.termType !== "NamedNode") return false;
  let protocol: string;
  try {
    protocol = new URL(object.value).protocol;
  } catch {
    // Un-parseable IRI — upstream's `j()` (`new URL(...)`) rejects it too, so it is
    // never fetched; not an import target, leave it untouched.
    return false;
  }
  return protocol === "http:" || protocol === "https:";
}

/**
 * Neutralise an untrusted VALUES graph before it is inlined into shacl-form: drop
 * every `(s, dct:conformsTo, <http(s) IRI>)` quad — the auto-import ROOT-SHAPE
 * trigger (and, when ALL conformsTo are http, the auto-DERIVATION source too).
 * Works on the parsed n3 Store (NEVER hand-edits Turtle text) and re-serialises
 * via `n3.Writer`. Returns the cleaned Turtle.
 *
 * This is a NARROW defence-in-depth layer, NOT the SSRF closer — the empty-shapes
 * fail-closed (fix 1 in shacl-view.ts) is what actually closes the auto-import
 * (its `countQuads(loaded-shapes) === 0` precondition can never hold for a mounted
 * form). See the block comment above.
 *
 * It deliberately PRESERVES `rdf:type` quads (load-bearing for shacl-form's
 * view-mode shape-selection — stripping them blanks a benign instance: the High)
 * and `dct:conformsTo` quads with a NON-http object (a legitimate `urn:` profile
 * reference shacl-form uses to derive the values subject so the instance renders).
 * Literals, blank nodes, and all other predicates are preserved verbatim, so the
 * rendered view is unchanged except for the removal of the http(s) conformsTo
 * import vector.
 */
export async function neutraliseValuesTurtle(turtle: string): Promise<string> {
  const store = await parseToStore(turtle, "text/turtle");
  const toRemove: Quad[] = [];
  for (const quad of store.getQuads(null, null, null, null)) {
    if (AUTO_IMPORT_PREDICATES.has(quad.predicate.value) && isHttpNamedNode(quad.object)) {
      toRemove.push(quad);
    }
  }
  for (const quad of toRemove) store.removeQuad(quad);
  return serializeTurtle(store);
}

/**
 * Parse a resolved SHAPES Turtle string and return its quad count. The element
 * uses this to FAIL CLOSED when the count is zero: an empty loaded-shapes graph
 * is the precondition for shacl-form's auto-import path, so a zero-quad shapes
 * graph must NEVER reach a mounted <shacl-form>.
 */
export async function countTurtleQuads(turtle: string): Promise<number> {
  const store = await parseToStore(turtle, "text/turtle");
  return store.size;
}

/**
 * A non-IRI sentinel set as `data-values-subject` so shacl-form does not
 * auto-DERIVE a values subject from the untrusted data graph (its
 * `valuesSubject ||= findConformsToValuesSubject(store)` is short-circuited by
 * any truthy value). A `urn:` subject is never an http(s) fetch target, and
 * shacl-form only fetches a `urn:` subject's imports when a `proxy` is set —
 * which this element never sets — so even the sentinel itself is fetch-inert.
 */
export const VALUES_SUBJECT_SENTINEL = "urn:jeswr:solid-components:shacl-view:values-subject";

/** A graph source for the view: an already-in-hand string, or a URL to pre-fetch. */
export type GraphSource =
  | {
      readonly kind: "inline";
      readonly text: string;
      /**
       * The RDF media type of `text`. MUST be a no-network RDF type
       * (Turtle/N-Triples/N-Quads/TriG); defaults to `text/turtle`. JSON-LD /
       * RDF-XML are REJECTED (§9 fix 4) — their parser resolves a remote
       * `@context`/import through an unguarded fetch.
       */
      readonly contentType?: string;
    }
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

/**
 * Media types whose parsing never triggers a FURTHER network fetch (no remote
 * `@context` / no schema import). §9 fix (4): the wrapper accepts ONLY these —
 * for `inline`, `trusted` AND `remote` sources — because the canonical parser's
 * JSON-LD path uses `jsonld-streaming-parser`'s default `FetchDocumentLoader`,
 * which fetches a remote `@context` IRI through an UNGUARDED `globalThis.fetch`.
 * Turtle/N-Triples/N-Quads/TriG have no such second-fetch surface.
 */
const NO_NETWORK_RDF_TYPES = new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
]);

/**
 * Throw unless `mediaType` is a no-network RDF type. Used uniformly so a JSON-LD
 * / RDF-XML body can never reach the parser (and its unguarded remote-`@context`
 * fetch) regardless of the source kind.
 */
function assertNoNetworkRdfType(mediaType: string, context: string): void {
  if (!NO_NETWORK_RDF_TYPES.has(mediaType)) {
    throw new Error(
      `Refusing ${context}: content-type "${mediaType}" is not a no-network RDF type ` +
        "(Turtle/N-Triples/N-Quads/TriG). JSON-LD/RDF-XML are rejected because the parser " +
        "would resolve a remote @context/import through an unguarded fetch (an SSRF surface).",
    );
  }
}

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
    // §9 fix (4) — NO-NETWORK RDF TYPES ONLY, uniformly (not just for `remote`).
    // The canonical parser (@jeswr/fetch-rdf `parseRdf`) parses JSON-LD with the
    // default `jsonld-streaming-parser`, which has NO SSRF-safe documentLoader: a
    // remote `@context` IRI in a JSON-LD body triggers an UNGUARDED `globalThis.
    // fetch`. So an inline source must declare a no-network RDF type (default
    // Turtle); JSON-LD / RDF-XML are refused even inline.
    const declaredType = (source.contentType ?? "text/turtle").split(";")[0].trim().toLowerCase();
    assertNoNetworkRdfType(declaredType, "inline source");
    // Re-parse + re-serialise so what reaches shacl-form is normalised Turtle from
    // the canonical parser, not an arbitrary string. (Also catches malformed input
    // up front rather than inside shacl-form.)
    const store = await parseToStore(source.text, declaredType);
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
    // §9 fix (4) — a `trusted` URL is app-chosen but the BODY at it may not be:
    // a trusted-but-foreign resource (or a redirected one) could serve JSON-LD
    // whose remote `@context` triggers an unguarded parser fetch (see the inline
    // note). So `trusted` is ALSO no-network-only now — a JSON-LD body is
    // refused, closing the §9 Low that previously left this path JSON-LD-open.
    return fetchAndSerialise(source.url, doFetch, { signal: options.signal });
  }

  // source.kind === "remote" — the untrusted path. NEVER the app seam, ALWAYS the
  // SSRF guard. The guard itself is dynamically imported so it (and undici on
  // Node) stays out of the base bundle. No-network-only: a JSON-LD document's
  // remote `@context` can trigger a SECOND, UNGUARDED network fetch inside the
  // parser — that would defeat the SSRF guard. Turtle has no remote-fetch surface.
  const guarded = await loadGuarded(options);
  return fetchAndSerialise(source.url, guarded, {
    signal: options.signal,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}

interface FetchAndSerialiseOptions {
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

/**
 * Fetch a URL with the given fetch, parse + re-serialise to Turtle. NO-NETWORK
 * ONLY (§9 fix 4): asks for Turtle and REFUSES any response whose content-type is
 * not a no-network RDF type, so the parser never resolves a remote @context.
 */
async function fetchAndSerialise(
  url: string,
  doFetch: typeof fetch,
  opts: FetchAndSerialiseOptions,
): Promise<string> {
  const response = await doFetch(url, {
    method: "GET",
    // Ask for Turtle ONLY — never JSON-LD (no remote-@context fetch surface).
    headers: { Accept: "text/turtle" },
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
  // SSRF defence: a JSON-LD body could pull a remote @context through an
  // UNGUARDED parser fetch. We asked for Turtle only; if the server replied with
  // anything that is not a no-network RDF type, refuse it.
  const mediaType = (contentType ?? "text/turtle").split(";")[0].trim().toLowerCase();
  assertNoNetworkRdfType(mediaType, `graph ${url}`);
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
