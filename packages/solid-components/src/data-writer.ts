// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// DataController WRITE seam (Phase 2). The injectable, fail-closed write-path the
// editable components drive their save through — the counterpart to the Phase-1
// read DataController. It owns the THREE write invariants:
//
//   1. CONDITIONAL writes (the lost-update guard). An UPDATE of an existing,
//      ETag-bearing resource is a conditional `If-Match: <etag>` PUT — never an
//      unconditional overwrite. The controller REFUSES an unconditional overwrite
//      of an existing resource (fail-closed): a `save` without an etag is only
//      allowed when the caller asserts the resource does NOT yet exist
//      (`ifNoneMatch: "*"`, a CREATE). This is the same discipline the suite's
//      forks bake in (create-only `If-None-Match: *`, CAS update `If-Match`).
//
//   2. §10 MERGE-NOT-REPLACE (the CORRECTNESS invariant — see saveMerged). A naive
//      `form.toRDF() → PUT` silently DROPS every triple outside the SHACL shape AND
//      clobbers the dual-predicate federation compat (e.g. a task writes BOTH
//      `wf:description` + `dct:description`). So a save must LOAD the existing graph
//      (keeping its ETag), apply the form's delta through the MODEL's typed accessor
//      / a SHACL-targeted patch (only the shape-covered predicates change),
//      PRESERVE every untouched triple, then conditionally PUT the merged graph.
//
//   3. SCOPE GUARD (fail-closed). A write must NEVER leave the configured base /
//      container — same-origin, path-prefixed, http(s)-only, no embedded
//      credentials, no scheme-relative. A target outside the base THROWS before any
//      fetch fires, so a hostile/buggy `src` can't be used to write a foreign
//      resource with the user's authenticated fetch.
//
// CREDENTIAL BOUNDARY: writes use ONLY the OWN-ORIGIN authenticated `fetch` (a
// write is, by definition, to the user's own pod). There is NO public-write path —
// you do not write to a foreign origin with a credential-free fetch. The seam
// therefore carries only the authenticated `fetch`.
//
// RDF DISCIPLINE: the merged graph is serialised by `n3.Writer` (via serialize.ts).
// The form-delta application goes through the MODEL's typed accessors (the per-class
// form components pass a mutator that uses `Task`/`Contact`/`Bookmark` setters) —
// NEVER a hand-built quad. This module's own graph handling reads/removes quads off
// the n3 Store directly (a read/remove query — no triple is hand-BUILT here), and
// the new shaped-node triples come from the typed-accessor mutator the caller gives.

import { Store } from "n3";
import { parseToStore } from "./rdf.js";
import { serializeTurtle } from "./serialize.js";

/** `text/turtle` — the format every write serialises to + the Accept for the read-back. */
const TURTLE = "text/turtle";
/** The Accept header for the merge pre-read — Turtle first, JSON-LD fallback (Solid §5.2). */
const RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9";

/**
 * The write seam: the OWN-ORIGIN authenticated fetch + the base the writes are
 * confined to. A write is always to the user's own pod, so there is no
 * `publicFetch` here (writing to a foreign origin with a credential-free fetch is a
 * non-feature). `fetch` defaults to `globalThis.fetch` when omitted.
 */
export interface WriteSeam {
  /** The session-bound authenticated fetch. Defaults to `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /**
   * The base URL every write must stay within (same origin + a path prefix). When
   * set, a save/delete to a target OUTSIDE this base is REFUSED before any fetch.
   * Omit it to disable the path-prefix check (the origin/scheme checks still apply
   * relative to the target itself, and a caller without a base SHOULD constrain
   * targets another way). Strongly recommended: set it to the app's pod root /
   * working container so a buggy `src` can never write elsewhere.
   */
  readonly base?: string;
}

/** The lifecycle state a save/delete moves through (the components surface it). */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** The result of a conditional write. */
export interface WriteResult {
  /** The resource URL written (the final URL after any redirect, else the target). */
  readonly url: string;
  /** The NEW `ETag` the server returned, when present — keep it for the next write. */
  readonly etag?: string;
}

/** Options common to the conditional writes. */
export interface ConditionalWriteOptions {
  /**
   * The `If-Match` value (the etag of the version being replaced) — the lost-update
   * guard for an UPDATE. REQUIRED to overwrite an existing resource unless
   * {@link ConditionalWriteOptions.ifNoneMatch} asserts a create.
   */
  readonly ifMatch?: string;
  /**
   * `If-None-Match: "*"` for a CREATE-ONLY write (the resource must NOT already
   * exist). Pass `"*"` (the only meaningful value) to create-if-absent. Mutually
   * exclusive with {@link ConditionalWriteOptions.ifMatch}.
   */
  readonly ifNoneMatch?: string;
  /** Abort signal threaded into the fetch. */
  readonly signal?: AbortSignal;
  /** Extra headers merged in (Content-Type + the conditional headers always win). */
  readonly headers?: Record<string, string>;
}

/** Options for {@link DataWriter.saveMerged} — the §10 merge save. */
export interface SaveMergedOptions {
  /**
   * Abort signal threaded into BOTH the pre-read and the write. A single signal so
   * an abort cancels the whole save atomically.
   */
  readonly signal?: AbortSignal;
  /**
   * Treat a 404 on the pre-read as "the resource does not exist yet" → a
   * CREATE-ONLY (`If-None-Match: "*"`) write of the mutator's output applied to an
   * EMPTY graph, instead of a merge. Default `true` (a save of a not-yet-existing
   * resource creates it). Set `false` to require the resource to pre-exist (a save
   * then fails on a missing resource).
   */
  readonly createIfAbsent?: boolean;
}

/**
 * What a {@link ShapedNodeMutator} resolves to: nothing (`undefined` — it mutated
 * the passed graph in place) OR a fresh Store to write instead (a pure-build path).
 */
export type MutatorResult = Store | undefined;

/**
 * A mutator that applies the form's edited values to the (already-loaded) existing
 * graph through the MODEL's typed accessors. It receives the live n3 Store (the
 * existing resource graph, with every untouched triple intact) and the resource
 * URL; it must apply ONLY the shape-covered predicates of the edited subject via the
 * model's typed setters (`Task`/`Contact`/`Bookmark`), leaving all other triples
 * untouched. It MUST NOT hand-build a quad. Returning is optional (it mutates in
 * place → return `undefined`); a returned Store is used instead, for callers that
 * prefer a pure build.
 */
export type ShapedNodeMutator = (
  graph: Store,
  resourceUrl: string,
) => MutatorResult | Promise<MutatorResult>;

/** Thrown when a write target falls outside the configured base / scope guard. */
export class WriteScopeError extends Error {
  /** The offending target URL. */
  readonly url: string;
  constructor(url: string, reason: string) {
    super(`Refusing to write ${url}: ${reason}`);
    this.name = "WriteScopeError";
    this.url = url;
    Object.setPrototypeOf(this, WriteScopeError.prototype);
  }
}

/**
 * Thrown when a caller asks to overwrite an existing, ETag-bearing resource WITHOUT
 * a conditional (`If-Match` / `If-None-Match`). The fail-closed lost-update guard:
 * an unconditional overwrite of an existing resource is never allowed.
 */
export class UnconditionalOverwriteError extends Error {
  /** The resource URL the unconditional overwrite targeted. */
  readonly url: string;
  constructor(url: string) {
    super(
      `Refusing an UNCONDITIONAL overwrite of ${url}: a write that replaces an existing ` +
        'resource requires an `If-Match` etag (the lost-update guard), or `If-None-Match: "*"` ' +
        "to create-if-absent. Pass the etag you read, or use saveMerged() which reads it for you.",
    );
    this.name = "UnconditionalOverwriteError";
    this.url = url;
    Object.setPrototypeOf(this, UnconditionalOverwriteError.prototype);
  }
}

/** Thrown when a conditional write is rejected by the server (412 / 409 / 428). */
export class WriteConflictError extends Error {
  /** The resource URL the conflicting write targeted. */
  readonly url: string;
  /** The HTTP status the server returned (412 / 409 / 428). */
  readonly status: number;
  constructor(url: string, status: number) {
    super(
      `Write to ${url} conflicted (HTTP ${status}): the resource changed since you read it ` +
        "(lost-update guard fired) or already exists. Re-read it and retry.",
    );
    this.name = "WriteConflictError";
    this.url = url;
    this.status = status;
    Object.setPrototypeOf(this, WriteConflictError.prototype);
  }
}

/** Thrown for any other non-2xx write failure (transport / 4xx / 5xx). */
export class WriteFailedError extends Error {
  /** The resource URL. */
  readonly url: string;
  /** The HTTP status, when the failure came from a response. */
  readonly status?: number;
  constructor(url: string, options?: { status?: number; cause?: unknown }) {
    super(
      options?.status !== undefined
        ? `Write to ${url} failed with status ${options.status}`
        : `Write to ${url} failed`,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "WriteFailedError";
    this.url = url;
    this.status = options?.status;
    Object.setPrototypeOf(this, WriteFailedError.prototype);
  }
}

/**
 * The injectable WRITE-path controller. Construct once with a {@link WriteSeam} and
 * reuse it; it holds no per-resource state (the ETag is the caller's to keep, and
 * `saveMerged` reads it for you). Every write is scope-guarded + conditional.
 */
export class DataWriter {
  readonly #fetch: typeof fetch;
  readonly #base: string | undefined;

  constructor(seam: WriteSeam = {}) {
    this.#fetch = seam.fetch ?? globalThis.fetch.bind(globalThis);
    this.#base = seam.base;
  }

  /** The base every write is confined to, or `undefined` (no path-prefix check). */
  get base(): string | undefined {
    return this.#base;
  }

  /**
   * §10 MERGE-NOT-REPLACE save (THE correctness invariant). Loads the existing
   * resource graph (keeping its ETag), applies the form's edited values via the
   * MODEL's typed-accessor mutator onto that loaded graph (so only the shape-covered
   * predicates change — incl. dual-predicate writes — and every untouched triple is
   * preserved), then conditionally `If-Match` PUTs the merged graph.
   *
   * If the resource does not exist yet (404 on the pre-read) and
   * `createIfAbsent` (default true), the mutator is applied to an EMPTY graph and
   * the result is CREATE-ONLY written (`If-None-Match: "*"`) so a concurrent
   * creation cannot be clobbered.
   *
   * @param url     - the resource to save (scope-guarded against the base).
   * @param mutate  - applies the form delta through the model's typed setters.
   * @param options - see {@link SaveMergedOptions}.
   * @throws {@link WriteScopeError} if `url` is outside the base.
   * @throws {@link WriteConflictError} on a 412/409/428 (lost-update / exists).
   * @throws {@link WriteFailedError} on any other write failure.
   */
  async saveMerged(
    url: string,
    mutate: ShapedNodeMutator,
    options: SaveMergedOptions = {},
  ): Promise<WriteResult> {
    // Scope guard FIRST — before any network — so a hostile target never even reads.
    this.#assertWithinScope(url);

    const createIfAbsent = options.createIfAbsent ?? true;
    const pre = await this.#readForMerge(url, options.signal);

    if (pre.kind === "missing") {
      if (!createIfAbsent) {
        throw new WriteFailedError(url, { status: 404 });
      }
      // CREATE: apply the mutator to an EMPTY graph; write create-only.
      const created = await applyMutator(new Store(), url, mutate);
      const turtle = await serializeTurtle(created);
      return this.#put(url, turtle, { ifNoneMatch: "*", signal: options.signal });
    }

    // UPDATE (merge): the loaded graph already holds every existing triple. Apply
    // the form delta through the typed-accessor mutator IN PLACE (or take a returned
    // Store), preserving all untouched triples, then conditional-PUT it.
    const merged = await applyMutator(pre.graph, url, mutate);
    const turtle = await serializeTurtle(merged);
    // The pre-read MUST have yielded an etag for a conditional update. If the server
    // serves an existing resource with NO ETag (rare; some static hosts), we cannot
    // safely overwrite it — fail closed rather than do an unconditional PUT.
    if (!pre.etag) {
      throw new UnconditionalOverwriteError(url);
    }
    return this.#put(url, turtle, { ifMatch: pre.etag, signal: options.signal });
  }

  /**
   * Conditional PUT of a Turtle body. ENFORCES the lost-update guard: overwriting an
   * existing resource requires `ifMatch`; `ifNoneMatch: "*"` is the create-only
   * alternative. An UNCONDITIONAL PUT (neither set) is REFUSED unless
   * `allowUnconditional` is explicitly passed (used only for a brand-new resource a
   * caller has already proven absent some other way — `saveMerged` never uses it).
   *
   * @throws {@link UnconditionalOverwriteError} if neither conditional is set.
   * @throws {@link WriteScopeError} if `url` is outside the base.
   * @throws {@link WriteConflictError} / {@link WriteFailedError} on a failure.
   */
  async putTurtle(
    url: string,
    turtle: string,
    options: ConditionalWriteOptions & { allowUnconditional?: boolean } = {},
  ): Promise<WriteResult> {
    this.#assertWithinScope(url);
    if (options.ifMatch && options.ifNoneMatch) {
      throw new Error("Pass at most one of ifMatch / ifNoneMatch.");
    }
    if (!options.ifMatch && !options.ifNoneMatch && !options.allowUnconditional) {
      // Fail-closed: never an unconditional overwrite of a (possibly existing) resource.
      throw new UnconditionalOverwriteError(url);
    }
    return this.#put(url, turtle, options);
  }

  /**
   * Conditional DELETE. Requires `ifMatch` (the lost-update guard) — an
   * unconditional delete of an existing resource is refused, mirroring the write
   * discipline. Scope-guarded.
   */
  async delete(url: string, options: { ifMatch: string; signal?: AbortSignal }): Promise<void> {
    this.#assertWithinScope(url);
    if (!options.ifMatch) throw new UnconditionalOverwriteError(url);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "DELETE",
        headers: { "If-Match": options.ifMatch },
        // SCOPE GUARD (redirect-SSRF) — see #put: refuse a redirect rather than
        // delete an off-scope resource via a 307/308 to another origin/path.
        redirect: "error",
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      throw new WriteFailedError(url, { cause });
    }
    if (response.status === 412 || response.status === 409 || response.status === 428) {
      throw new WriteConflictError(url, response.status);
    }
    if (!response.ok && response.status !== 404) {
      throw new WriteFailedError(url, { status: response.status });
    }
  }

  /** The low-level conditional PUT (after the scope + conditional checks). */
  async #put(url: string, turtle: string, options: ConditionalWriteOptions): Promise<WriteResult> {
    const headers: Record<string, string> = {
      ...options.headers,
      "Content-Type": TURTLE,
    };
    if (options.ifMatch) headers["If-Match"] = options.ifMatch;
    if (options.ifNoneMatch) headers["If-None-Match"] = options.ifNoneMatch;

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "PUT",
        headers,
        body: turtle,
        // SCOPE GUARD (redirect-SSRF): `fetch` follows redirects by DEFAULT, so a
        // scoped target that 307/308-redirects to a DIFFERENT origin/path would do
        // the AUTHENTICATED write OUTSIDE the guarded scope (the `#assertWithinScope`
        // check only saw the original URL). `redirect: "error"` makes a redirected
        // write REJECT rather than silently follow it off-scope. (A Solid PUT to your
        // own pod is never legitimately redirected cross-origin.)
        redirect: "error",
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      throw new WriteFailedError(url, { cause });
    }
    const finalUrl = response.url || url;
    // A failed conditional → a conflict (412), an exists-collision on create (409),
    // or a server demanding a precondition (428). Distinct from a generic failure so
    // a UI can prompt "reload + retry".
    if (response.status === 412 || response.status === 409 || response.status === 428) {
      throw new WriteConflictError(finalUrl, response.status);
    }
    if (!response.ok) {
      throw new WriteFailedError(finalUrl, { status: response.status });
    }
    const etag = response.headers.get("ETag");
    return { url: finalUrl, ...(etag ? { etag } : {}) };
  }

  /**
   * Read the existing resource for a merge: parse it to a Store + keep its ETag, OR
   * report it MISSING (404/410). Any other read failure throws a WriteFailedError so
   * a save never silently proceeds on a transport error.
   */
  async #readForMerge(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ kind: "present"; graph: Store; etag?: string } | { kind: "missing" }> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: { Accept: RDF_ACCEPT },
        // SCOPE GUARD (redirect-SSRF): refuse a redirected pre-read too — a 307/308 to
        // a foreign origin would merge that origin's body + ETag, which we'd then
        // conditionally PUT back. The merge base must be the EXACT scoped resource.
        redirect: "error",
        ...(signal ? { signal } : {}),
      });
    } catch (cause) {
      throw new WriteFailedError(url, { cause });
    }
    // Belt-and-braces: re-assert the post-read URL is within scope BEFORE any status
    // branch (even with `redirect: "error"`, a non-spec/injected fetch might follow a
    // redirect and surface a foreign final URL). This MUST precede the 404/410 branch:
    // an OFF-SCOPE 404/410 (a redirect to a foreign origin that 404s) must FAIL CLOSED,
    // not be read as "the scoped resource is missing" → a create-only PUT. So a
    // foreign final URL is refused regardless of the status it returned.
    const finalUrl = response.url || url;
    this.#assertWithinScope(finalUrl);
    if (response.status === 404 || response.status === 410) return { kind: "missing" };
    if (!response.ok) {
      throw new WriteFailedError(finalUrl, { status: response.status });
    }
    const contentType = response.headers.get("Content-Type");
    let graph: Store;
    try {
      const body = response.body ?? (await response.text());
      graph = await parseToStore(body, contentType, { baseIRI: finalUrl });
    } catch (cause) {
      throw new WriteFailedError(finalUrl, { cause });
    }
    const etag = response.headers.get("ETag");
    return { kind: "present", graph, ...(etag ? { etag } : {}) };
  }

  /**
   * SCOPE GUARD (fail-closed). Throw a {@link WriteScopeError} unless `target` is a
   * safe write target: an absolute http(s) URL, no embedded credentials, and — when
   * a base is configured — same origin + a path under the base's directory. Mirrors
   * the suite forks' `assertWithinBase`. Run BEFORE any fetch.
   */
  #assertWithinScope(target: string): void {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new WriteScopeError(target, "not an absolute URL");
    }
    const scheme = url.protocol.toLowerCase();
    if (scheme !== "http:" && scheme !== "https:") {
      throw new WriteScopeError(target, `non-http(s) scheme "${url.protocol}"`);
    }
    if (url.username || url.password) {
      throw new WriteScopeError(target, "embedded credentials in the URL");
    }
    if (this.#base === undefined) return; // no path-prefix check configured.

    let base: URL;
    try {
      base = new URL(this.#base);
    } catch {
      throw new WriteScopeError(target, `the configured base "${this.#base}" is not a valid URL`);
    }
    if (url.origin !== base.origin) {
      throw new WriteScopeError(target, `different origin from the base (${base.origin})`);
    }
    // Path-prefix: the target's path must be at or below the base DIRECTORY. Compare
    // on the base's directory prefix (everything up to + including the last "/") so
    // `…/c/` admits `…/c/x` but a sibling `…/c-evil/x` (a prefix-string trick) is
    // rejected. Decode neither — compare the raw, already-normalised URL pathnames
    // (the URL constructor resolved any `..`/`.` segments).
    const baseDir = base.pathname.endsWith("/")
      ? base.pathname
      : base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1);
    if (!url.pathname.startsWith(baseDir)) {
      throw new WriteScopeError(target, `path is outside the base directory (${baseDir})`);
    }
  }
}

/**
 * Apply a {@link ShapedNodeMutator} to a graph: call it (it mutates in place or
 * returns a Store), and use whichever Store results. Centralised so both the
 * create + update paths apply the mutator identically.
 */
async function applyMutator(
  graph: Store,
  resourceUrl: string,
  mutate: ShapedNodeMutator,
): Promise<Store> {
  const returned = await mutate(graph, resourceUrl);
  return returned instanceof Store ? returned : graph;
}
