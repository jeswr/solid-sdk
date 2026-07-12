// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// DataController — the injectable READ seam every suite pod-app hand-rolls,
// consolidated once. It mirrors @jeswr/solid-elements' LoginController: a small,
// dependency-injectable structural contract (the `DataSeam`) plus a concrete
// default implementation, so an element / a consuming app drives reads through it
// and a test injects a mock without standing up a pod.
//
// READ ONLY (Phase 1). No PUT/PATCH/POST/DELETE here — the write path + an
// editable form are Phase 2. This module deliberately exposes only:
//   - typed RDF read of a single resource (parse via @jeswr/fetch-rdf → N3.Store)
//   - a container LISTING (ldp:contains children of an LDP container)
//   - conditional GET (carry + honour the ETag → a 304 short-circuit)
//   - the 4-class error taxonomy (errors.ts), so a UI branches on the CLASS.
//
// The credential-leak boundary is the same two-fetch seam as LoginController:
//   - `fetch`       — the session-bound authenticated fetch (the user's origin).
//   - `publicFetch` — the pristine, credential-free fetch for foreign/public
//     reads. When omitted it falls back to `fetch` (a single-origin app), but a
//     caller that reads foreign data SHOULD inject a distinct pristine fetch so a
//     session token can never leak cross-origin. This module NEVER patches the
//     global fetch and NEVER follows a redirect with credentials silently — it
//     leaves redirect handling to the injected fetch.
//
// RDF DISCIPLINE: parsing goes through `@jeswr/fetch-rdf`'s `parseRdf` (the suite
// canonical parser) — never a hand-rolled parser. The container listing reads
// `ldp:contains` quads off the parsed N3.Store directly (a tiny, read-only quad
// query — no triple is ever hand-BUILT here).

import type { NamedNode, Quad } from "@rdfjs/types";
import type { Store } from "n3";
import {
  AccessDeniedError,
  classifyReadError,
  type DataControllerError,
  NetworkError,
  NotFoundError,
} from "./errors.js";
import { parseToStore } from "./rdf.js";

const LDP_CONTAINS = "http://www.w3.org/ns/ldp#contains";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const LDP_CONTAINER = "http://www.w3.org/ns/ldp#Container";
const LDP_BASIC_CONTAINER = "http://www.w3.org/ns/ldp#BasicContainer";

/** The Accept header for an RDF read — Turtle first, JSON-LD fallback (Solid §5.2). */
const RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9";

/**
 * The dependency-injection seam the DataController is constructed with. Every
 * field is optional except — at least one fetch must be derivable: `fetch`
 * defaults to `globalThis.fetch`, and `publicFetch` defaults to `fetch`.
 */
export interface DataSeam {
  /**
   * The session-bound authenticated fetch. Used for the user's own origin(s).
   * Defaults to `globalThis.fetch` when omitted (an unauthenticated reader).
   */
  readonly fetch?: typeof fetch;
  /**
   * The credential-free fetch for foreign-origin / public reads. There is NO
   * default and NO fallback: a `{ public: true }` read REQUIRES this to be set
   * (else it throws). It must NOT carry the session's DPoP-bound token, so the
   * controller never falls back to {@link DataSeam.fetch} nor to a possibly-patched
   * `globalThis.fetch` for a public read. Inject a fetch you captured BEFORE any
   * auth code patched the global (e.g. solid-elements' `publicFetch`).
   */
  readonly publicFetch?: typeof fetch;
}

/** Per-read options. */
export interface ReadOptions {
  /**
   * Read with the PUBLIC (credential-free) fetch instead of the authenticated
   * one. Use for foreign-origin / public resources. Default `false`.
   */
  readonly public?: boolean;
  /**
   * A previously-returned {@link ReadResult.etag}. When present it is sent as
   * `If-None-Match`; a `304 Not Modified` resolves to a {@link ReadResult} with
   * `notModified: true` and NO fresh dataset (the caller keeps its cached copy).
   */
  readonly etag?: string;
  /** Abort signal threaded into the underlying fetch. */
  readonly signal?: AbortSignal;
  /** Extra request headers merged in (the Accept header is always overridden). */
  readonly headers?: Record<string, string>;
}

/**
 * Options for {@link DataController.listContainer}. Deliberately a SUBSET of
 * {@link ReadOptions} WITHOUT `etag`: a listing always needs the graph to enumerate
 * children, so a conditional 304 (no body) would be a usability trap. For
 * conditional re-listing, call {@link DataController.read} with the container's
 * etag and re-list only when it is NOT a 304.
 */
export type ListOptions = Omit<ReadOptions, "etag">;

/** The result of a (conditional) RDF read. */
export interface ReadResult {
  /**
   * The FINAL resource URL after any redirects (`response.url`), falling back to
   * the requested URL when the fetch impl does not expose it. This is the base
   * against which the body's relative IRIs were resolved.
   */
  readonly url: string;
  /**
   * The parsed RDF graph. `undefined` ONLY when {@link ReadResult.notModified} is
   * `true` (a 304 — the caller keeps its cached dataset). Always present on 2xx.
   */
  readonly dataset?: Store;
  /** The response `ETag`, when the server sent one — pass it back as a conditional. */
  readonly etag?: string;
  /** `true` when the server answered `304 Not Modified` to a conditional GET. */
  readonly notModified: boolean;
}

/** One child of an LDP container listing. */
export interface ContainerChild {
  /** The child resource's absolute URL (the `ldp:contains` object). */
  readonly url: string;
  /** Whether the child is itself an LDP container (best-effort from the listing). */
  readonly isContainer: boolean;
}

/** The result of a container listing read. */
export interface ContainerListing {
  /** The container URL that was listed. */
  readonly url: string;
  /** The container's children (order is the parse order; de-duplicated by URL). */
  readonly children: ContainerChild[];
  /** The container resource's ETag, when present — for a conditional re-list. */
  readonly etag?: string;
  /** The full parsed container graph, for callers that need more than the listing. */
  readonly dataset: Store;
}

/**
 * The injectable read-path controller. Construct once with a {@link DataSeam} and
 * reuse it; it holds no per-resource state (the ETag is the caller's to keep).
 */
export class DataController {
  readonly #fetch: typeof fetch;
  /** The injected credential-free fetch, or `undefined` (a public read fails closed). */
  readonly #publicFetch: typeof fetch | undefined;

  constructor(seam: DataSeam = {}) {
    // The authenticated / default path may fall back to the global fetch (that path
    // is allowed to be authenticated). Bound to globalThis so calling it as a free
    // function does not trip "Illegal invocation".
    this.#fetch = seam.fetch ?? globalThis.fetch.bind(globalThis);
    // CREDENTIAL BOUNDARY (fail-closed): a public read uses ONLY an explicitly
    // injected credential-free fetch. We do NOT default it — not to `this.#fetch`
    // (authenticated) and NOT to a captured `globalThis.fetch` (auth code may
    // already have patched the global to carry credentials by construction time).
    // A `{ public: true }` read without an injected `publicFetch` THROWS, so the
    // session's DPoP-bound token can never leak to a foreign origin.
    this.#publicFetch = seam.publicFetch;
  }

  /** The authenticated fetch this controller reads the user's own origin with. */
  get fetch(): typeof fetch {
    return this.#fetch;
  }

  /**
   * The injected credential-free fetch for public reads, or `undefined` when none
   * was supplied (a `{ public: true }` read then fails closed).
   */
  get publicFetch(): typeof fetch | undefined {
    return this.#publicFetch;
  }

  /**
   * Read one RDF resource into an N3 Store, classifying any failure onto the
   * 4-class taxonomy. Honours a conditional `If-None-Match` (the `etag` option):
   * a `304` resolves to `{ notModified: true }` with no dataset.
   *
   * A `{ public: true }` read REQUIRES an injected `publicFetch` (the credential
   * boundary is fail-closed) — without one it throws a {@link NetworkError} rather
   * than risk using the authenticated fetch.
   *
   * @throws {@link DataControllerError} — exactly one of NotFound / AccessDenied /
   *   Network / DataFormat. Never throws a raw `Response` or fetch error.
   */
  async read(url: string, options: ReadOptions = {}): Promise<ReadResult> {
    let doFetch: typeof fetch;
    if (options.public) {
      // Fail-closed: a public read must use an EXPLICIT credential-free fetch.
      if (!this.#publicFetch) {
        throw new NetworkError(url, {
          cause: new Error(
            "A { public: true } read requires an injected `publicFetch` (a credential-free " +
              "fetch). The DataController never falls back to the authenticated fetch for a " +
              "public read.",
          ),
        });
      }
      doFetch = this.#publicFetch;
    } else {
      doFetch = this.#fetch;
    }
    const headers: Record<string, string> = {
      ...options.headers,
      Accept: RDF_ACCEPT,
    };
    if (options.etag) headers["If-None-Match"] = options.etag;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: "GET",
        headers,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      // Transport failure / abort — no status to classify on.
      throw classifyReadError(url, cause);
    }

    // The FINAL URL after any redirects (e.g. the common trailing-slash container
    // redirect `…/c` → `…/c/`). Relative IRIs in the body — and the container
    // subject + its ldp:contains children — resolve against THIS, not the
    // originally-requested URL, so a redirected resource parses to the right
    // subjects and `listContainer` matches its children correctly. `response.url`
    // is empty on some fetch polyfills; fall back to the requested URL then.
    const finalUrl = response.url || url;

    if (response.status === 304) {
      return { url: finalUrl, notModified: true, ...etagOf(response) };
    }
    if (!response.ok) {
      throw statusError(finalUrl, response.status);
    }

    let dataset: Store;
    try {
      const contentType = response.headers.get("Content-Type");
      // Prefer streaming the body; fall back to text when a body stream is absent
      // (some fetch polyfills / jsdom do not expose `Response.body`). parseToStore
      // materialises a stream to text (the published parseRdf accepts a string).
      const body = response.body ?? (await response.text());
      dataset = await parseToStore(body, contentType, { baseIRI: finalUrl });
    } catch (cause) {
      // A 2xx whose body would not parse → a format error, not a network one.
      throw classifyReadError(finalUrl, cause, { status: response.status, parsed: false });
    }

    return { url: finalUrl, dataset, notModified: false, ...etagOf(response) };
  }

  /**
   * List an LDP container: read its RDF then collect every `ldp:contains` child.
   * Each child's `isContainer` is derived from an `rdf:type` of `ldp:Container` /
   * `ldp:BasicContainer` IF that triple is present in the container's own graph
   * (CSS/ESS commonly include it), else from a trailing-slash heuristic.
   *
   * @throws {@link DataControllerError} as {@link DataController.read} does.
   */
  async listContainer(url: string, options: ListOptions = {}): Promise<ContainerListing> {
    // `ListOptions` has no `etag`, so `read()` never sends `If-None-Match` and a
    // 304 cannot occur here — the result always carries a dataset. (The defensive
    // guard below is dead under the type, kept only to satisfy the optional type.)
    const result = await this.read(url, options);
    /* c8 ignore next 3 — unreachable: ListOptions forbids etag, so never a 304. */
    if (!result.dataset) {
      throw new NetworkError(result.url, {
        cause: new Error("listContainer unexpectedly received a 304 (no etag was sent)"),
      });
    }
    // Match children against the FINAL (post-redirect) container URL the body was
    // parsed against, not the originally-requested URL (trailing-slash redirects).
    return {
      url: result.url,
      children: childrenOf(result.dataset, result.url),
      dataset: result.dataset,
      ...(result.etag ? { etag: result.etag } : {}),
    };
  }
}

/** Extract `{ etag }` from a response, or `{}` when absent. */
function etagOf(response: Response): { etag?: string } {
  const etag = response.headers.get("ETag");
  return etag ? { etag } : {};
}

/** Map an HTTP status to the right taxonomy class (used on a non-2xx response). */
function statusError(url: string, status: number): DataControllerError {
  if (status === 404 || status === 410) return new NotFoundError(url, { status });
  if (status === 401 || status === 403) return new AccessDeniedError(url, { status });
  return new NetworkError(url, { status });
}

/**
 * Collect the `ldp:contains` children of a container graph. The container subject
 * is the resource URL itself. De-duplicates by URL preserving first-seen order.
 * Reads quads off the parsed Store directly (a read query — no triple is built).
 */
function childrenOf(dataset: Store, containerUrl: string): ContainerChild[] {
  const seen = new Set<string>();
  const out: ContainerChild[] = [];
  // `getQuads(subject, predicate, object, graph)` — n3's read API. We do not
  // assume the subject term form, so we filter on the predicate + the container
  // subject value to be robust to how the server names the container subject
  // (it is occasionally `<>` resolved against the base, occasionally the full URL).
  for (const quad of iterContains(dataset)) {
    const childUrl = quad.object.value;
    if (quad.subject.value !== containerUrl) continue;
    if (seen.has(childUrl)) continue;
    seen.add(childUrl);
    out.push({ url: childUrl, isContainer: isContainerChild(dataset, quad.object, childUrl) });
  }
  return out;
}

/** Every `ldp:contains` quad in the store. */
function iterContains(dataset: Store): Quad[] {
  return dataset.getQuads(null, namedNode(LDP_CONTAINS), null, null) as unknown as Quad[];
}

/** Whether `child` is typed as an LDP container, or (fallback) has a trailing slash. */
function isContainerChild(dataset: Store, child: Quad["object"], childUrl: string): boolean {
  for (const t of dataset.getQuads(child, namedNode(RDF_TYPE), null, null)) {
    const typeValue = (t as unknown as Quad).object.value;
    if (typeValue === LDP_CONTAINER || typeValue === LDP_BASIC_CONTAINER) return true;
  }
  return childUrl.endsWith("/");
}

/**
 * Build a NamedNode term for a quad-pattern query WITHOUT importing n3's
 * DataFactory at module scope (keeps the inline-bundled surface minimal). n3's
 * `getQuads` accepts a `{ termType, value }`-shaped term for the pattern.
 */
function namedNode(value: string): NamedNode {
  return { termType: "NamedNode", value, equals: termEquals } as unknown as NamedNode;
}

function termEquals(this: { termType: string; value: string }, other: unknown): boolean {
  return (
    other != null &&
    typeof other === "object" &&
    (other as { termType?: string }).termType === this.termType &&
    (other as { value?: string }).value === this.value
  );
}
