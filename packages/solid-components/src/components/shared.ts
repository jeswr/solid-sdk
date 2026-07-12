// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Shared scaffolding for the per-class READ components. Every read element follows
// the SAME small recipe, named once here so each component is a thin projection:
//
//   1. It is driven by a `src` URL (the resource / container) + an injectable
//      `fetch` / `publicFetch` seam, OR — the test/codegen path — by a pre-parsed
//      `dataset` (an n3 Store) set directly, so a render can be exercised with no
//      network. Setting `src` (re)reads through a DataController; setting `dataset`
//      renders it directly.
//   2. It reads through the shared `DataController` (the Phase-1 read seam) — the
//      credential boundary + the 4-class error taxonomy live there, not re-rolled.
//   3. It renders the parsed model's TYPED fields. Untrusted RDF literals reach the
//      DOM ONLY through Lit's text interpolation (`html\`${value}\``), which escapes
//      — never `unsafeHTML`, never an attribute that could execute (an href is
//      http(s)-filtered before it is bound). This is the read-only XSS discipline.
//
// NO DECORATORS (the suite convention from @jeswr/solid-elements + the existing
// <jeswr-shacl-view>): reactive props are declared via `static properties` +
// `declare` + constructor assignment. With `useDefineForClassFields: true` a
// class-field initializer would SHADOW Lit's reactive accessor; the declarative
// form sidesteps that footgun and avoids the standard-decorator transpile that trips
// a runtime token error under vitest.

import { html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import type { Store } from "n3";
import { DataController, type DataSeam } from "../data-controller.js";
import { DataControllerError } from "../errors.js";

/** The status of a read element's current load. */
export type ReadStatus = "idle" | "loading" | "ready" | "error";

/**
 * The set of property names whose change should (re)trigger a read. A subclass
 * EXTENDS this list (spread it, never duplicate it) so it inherits every base input
 * and cannot silently drift. The base watches `src` / `fetch` / `publicFetch` /
 * `publicRead`: `publicRead` MUST be here — it selects which fetch (`publicFetch` vs
 * the authed `fetch`) `loadFrom` reads with, so toggling `public-read` after the
 * initial load has to re-read through the now-correct credential path.
 */
export const BASE_INPUT_PROPS = ["src", "fetch", "publicFetch", "publicRead"] as const;

/**
 * Base class for the read-only data-binding elements. Holds the DataController seam,
 * the load lifecycle (idle/loading/ready/error with a supersede token), and the
 * shared render branches (loading / error / empty). A subclass implements
 * {@link AbstractReadElement.loadFrom} (how to read its resource — `read` vs
 * `listContainer`) and {@link AbstractReadElement.renderReady} (how to render the
 * parsed model).
 *
 * Drive it imperatively (the codegen-friendly path):
 *
 *   const el = document.createElement("jeswr-task-list");
 *   el.fetch = session.fetch;        // the user's authenticated fetch
 *   el.src = "https://alice.example/tasks/";
 *   document.body.append(el);
 *
 * …or render a pre-parsed graph with no network (tests / SSR-of-a-cached-graph):
 *
 *   el.dataset = store;              // an n3 Store already in hand
 */
export abstract class AbstractReadElement extends LitElement {
  /** The resource / container URL to read. Setting it (re)reads through the seam. */
  declare src: string | undefined;
  /** The session-bound authenticated fetch (the user's origin). */
  declare fetch: typeof fetch | undefined;
  /** The credential-free fetch for foreign/public reads (no fallback — see DataSeam). */
  declare publicFetch: typeof fetch | undefined;
  /** Read with the public (credential-free) fetch — for a foreign-origin `src`. */
  declare publicRead: boolean;
  /**
   * A pre-parsed n3 Store to render directly, bypassing the network. When set it
   * takes precedence over `src` for the NEXT render. (The codegen/test seam — render
   * a graph already in hand with no fetch.) NOTE: deliberately named `store`, NOT
   * `dataset`, because `HTMLElement.dataset` is a reserved DOM property (a
   * `DOMStringMap`); shadowing it with an n3 Store would break the element type.
   */
  declare store: Store | undefined;

  protected declare status: ReadStatus;
  protected declare errorMessage: string;
  /** The graph the current render is bound to (from `src` read or `dataset`). */
  protected declare graph: Store | undefined;
  /** The final (post-redirect) URL the graph was read from — the base for subjects. */
  protected declare baseUrl: string | undefined;

  /** A monotonically increasing token to drop the result of a superseded read. */
  #readToken = 0;

  static properties = {
    src: {},
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    publicRead: { type: Boolean, attribute: "public-read" },
    store: { attribute: false },
    status: { state: true },
    errorMessage: { state: true },
    graph: { state: true },
    baseUrl: { state: true },
  };

  constructor() {
    super();
    this.src = undefined;
    this.fetch = undefined;
    this.publicFetch = undefined;
    this.publicRead = false;
    this.store = undefined;
    this.status = "idle";
    this.errorMessage = "";
    this.graph = undefined;
    this.baseUrl = undefined;
  }

  /** Render into the light DOM so a consuming app can `::part`/style the output. */
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  /** The input prop names this element re-reads on. Override to extend the base set. */
  protected inputProps(): readonly string[] {
    return BASE_INPUT_PROPS;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    const changedKeys = changed as unknown as Map<string, unknown>;
    // A directly-set `store` renders without any network — handle it first.
    if (changedKeys.has("store")) {
      void this.#applyDirectStore();
      return;
    }
    if (this.inputProps().some((k) => changedKeys.has(k))) {
      void this.#read();
    }
  }

  /** Render the directly-set `store` (no network), or fall back to idle when cleared. */
  async #applyDirectStore(): Promise<void> {
    const token = ++this.#readToken;
    const ds = this.store;
    if (!ds) {
      this.graph = undefined;
      this.baseUrl = undefined;
      this.status = this.src ? this.status : "idle";
      // If a src is set, re-read it now that the direct store was cleared.
      if (this.src) void this.#read();
      return;
    }
    // The base for subjects of a directly-supplied graph is `src` if known, else "".
    this.graph = ds;
    this.baseUrl = this.src ?? "";
    this.errorMessage = "";
    if (token === this.#readToken) this.status = "ready";
  }

  /** Read `src` through a DataController, classify any failure, drop a superseded result. */
  async #read(): Promise<void> {
    const token = ++this.#readToken;
    // A directly-supplied store wins — do not overwrite it with a network read.
    if (this.store) return;
    const src = this.src;
    if (!src) {
      this.graph = undefined;
      this.baseUrl = undefined;
      this.errorMessage = "";
      this.status = "idle";
      return;
    }
    this.status = "loading";
    this.errorMessage = "";

    // CREDENTIAL BOUNDARY (fail-closed). The default/auth path may fall back to the
    // global fetch; `publicFetch` has NO fallback (a public read without it throws in
    // the DataController). We pass both seams through verbatim so the boundary stays
    // explicit and the session token can never leak to a foreign origin.
    const seam: DataSeam = {
      ...(this.fetch ? { fetch: this.fetch } : {}),
      ...(this.publicFetch ? { publicFetch: this.publicFetch } : {}),
    };
    const controller = new DataController(seam);

    try {
      const { graph, baseUrl } = await this.loadFrom(controller, src, this.publicRead);
      if (token !== this.#readToken) return; // superseded.
      this.graph = graph;
      this.baseUrl = baseUrl;
      this.status = "ready";
    } catch (error) {
      if (token !== this.#readToken) return;
      this.graph = undefined;
      this.baseUrl = undefined;
      this.errorMessage = errorMessageOf(error);
      this.status = "error";
    }
  }

  /**
   * Read this element's resource through the controller and return the parsed graph
   * plus the base URL its subjects resolve against. A single-resource element calls
   * `controller.read`; a container element calls `controller.listContainer`.
   */
  protected abstract loadFrom(
    controller: DataController,
    src: string,
    publicRead: boolean,
  ): Promise<{ graph: Store; baseUrl: string }>;

  /** Render the parsed model once `status === "ready"` (the subject graph in `graph`). */
  protected abstract renderReady(graph: Store, baseUrl: string): TemplateResult;

  protected override render(): TemplateResult {
    switch (this.status) {
      case "idle":
        return html`<slot name="empty"><p part="empty">Nothing to display.</p></slot>`;
      case "loading":
        return html`<slot name="loading"><p part="loading">Loading…</p></slot>`;
      case "error":
        // Lit text interpolation escapes — never innerHTML.
        return html`<p part="error" role="alert">${this.errorMessage}</p>`;
      default:
        // ready — graph + baseUrl are set together with status="ready".
        return this.graph !== undefined && this.baseUrl !== undefined
          ? this.renderReady(this.graph, this.baseUrl)
          : html`<slot name="empty"><p part="empty">Nothing to display.</p></slot>`;
    }
  }
}

/** A user-facing message for a thrown read error (the taxonomy class carries it). */
function errorMessageOf(error: unknown): string {
  if (error instanceof DataControllerError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * An http(s)-only href filter for any IRI bound to an `<a href>`. Pod data is
 * untrusted: a `javascript:` / `data:` value must NEVER reach an href. Returns the
 * IRI when it is a well-formed http(s) URL, else `undefined` (the caller renders the
 * value as escaped TEXT instead of a link). Mirrors the data models' http(s) filter.
 */
export function safeHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A `mailto:` filter for an email href. The contact model already returns canonical
 * `mailto:` IRIs, but this is the belt-and-braces filter at the DOM boundary so a
 * malformed value renders as text, not a link.
 */
export function safeMailto(value: string | undefined): string | undefined {
  return value && /^mailto:[^\s]+@?[^\s]*$/i.test(value) ? value : undefined;
}

/** A `tel:` filter for a phone href, same belt-and-braces rationale as {@link safeMailto}. */
export function safeTel(value: string | undefined): string | undefined {
  return value && /^tel:[^\s]+$/i.test(value) ? value : undefined;
}

/** Strip a leading `mailto:` / `tel:` scheme for display text (the raw address). */
export function stripScheme(value: string): string {
  return value.replace(/^(mailto:|tel:)/i, "");
}

/** Format a Date for display, or empty string for undefined. Locale-default, date only. */
export function formatDate(date: Date | undefined): string {
  if (!date) return "";
  try {
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}
