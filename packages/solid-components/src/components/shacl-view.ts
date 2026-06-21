// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-shacl-view> — a READ-ONLY (view mode) Lit element wrapping
// @ulb-darmstadt/shacl-form. It renders a SHACL shape + a data graph as a
// human-readable view (no editing — Phase 2 owns the write/edit path).
//
// §9 SSRF DISCIPLINE (load-bearing — the whole reason this wrapper exists):
//   - It NEVER sets shacl-form's `data-shapes-url` / `data-values-url`. Giving
//     shacl-form a URL would let IT fetch — with the bundle's bare `fetch`, no
//     SSRF guard, following redirects, on whatever origin the URL names. That is
//     the SSRF surface we refuse to expose.
//   - It ALWAYS sets `data-ignore-owl-imports`, so shacl-form never follows an
//     `owl:imports` in the shapes/data graph to fetch a remote ontology.
//   - It ALWAYS sets `data-view` (empty value), forcing shacl-form into VIEW mode
//     (shacl-form's `editMode = data-view === null`, so a non-null value ⇒
//     read-only).
//   - It PRE-FETCHES the shape + data ITSELF (shacl-view-fetch.ts) through the
//     injected auth seam (.fetch / .publicFetch) for trusted URLs, and through
//     @jeswr/guarded-fetch for a user-configured REMOTE url, then serialises to
//     Turtle and passes INLINE `data-shapes` / `data-values` strings.
//   - Untrusted RDF literals reach the DOM only as shacl-form's text content
//     (shacl-form sets text nodes / `.innerText` for values, not innerHTML), and
//     this element's own error display uses Lit text interpolation (escaped),
//     never innerHTML.
//
// SHACL-FORM'S SECOND, NON-OBVIOUS FETCH PATH (the auto-import — `data-ignore-
// owl-imports` does NOT cover it): shacl-form's `loadGraphs()` auto-derives a
// "values subject" from the DATA graph (`findConformsToValuesSubject` — any
// single NamedNode subject bearing `dct:conformsTo`) and, ONLY when the loaded
// SHAPES graph is EMPTY (`countQuads(loaded-shapes) === 0`), issues an UNGUARDED
// `globalThis.fetch` to every http(s) IRI that subject points at via `rdf:type`
// and `dct:conformsTo` (incl. prefix-expanded IRIs), parsing the body into the
// rendered graph.
//
// The EMPTY-SHAPES precondition is the whole surface — with a NON-empty loaded-
// shapes graph the auto-import branch never runs (execution-verified against the
// real upstream `loadGraphs`). So fix (1) is the SSRF CLOSER; (2) is a narrow
// defence-in-depth second layer, NOT an independent closer:
//   (1) *** THE CLOSER *** FAIL-CLOSED on an empty resolved SHAPES graph — parse
//       it (n3) and if it has zero quads, render the error state and NEVER mount
//       <shacl-form> (so `countQuads(loaded-shapes) === 0` can never hold for a
//       mounted form). This alone closes the auto-import SSRF.
//   (2) NEUTRALISE the untrusted VALUES graph — drop every `dct:conformsTo` quad
//       whose object is an http(s) IRI before inlining (removes the http(s)
//       conformsTo import target + the auto-derivation source when all conformsTo
//       are http). It deliberately KEEPS `rdf:type` (load-bearing for shacl-form's
//       view-mode shape-selection — stripping it blanks a benign instance: the
//       High) and KEEPS `dct:conformsTo` → a non-http (`urn:`) profile reference
//       (legit, non-SSRF, used to derive the values subject so data renders). (2)
//       is NOT independently complete for the (conformsTo→urn KEPT + rdf:type→http)
//       edge on empty shapes — that edge is covered by (1), not (2).
//   (3) SUPPRESS auto-DERIVATION of a values subject — handled by (1): the auto-
//       import branch never runs for a mounted form (non-empty shapes), so the
//       derived subject is never followed. We do NOT pin a foreign
//       `data-values-subject` sentinel: shacl-form binds the rendered shape to that
//       subject, so a sentinel absent from the data would blank the view (verified
//       vs the shacl-form source). See render().
//
// NO-NETWORK RDF TYPES ONLY (§9 fix 4): the pre-fetch refuses a JSON-LD / RDF-XML
// body for EVERY source kind (inline/trusted/remote) — the canonical parser's
// JSON-LD path uses an unguarded `FetchDocumentLoader` for a remote `@context`.
//
// Tests assert NO `*-url` attribute is ever set on the inner <shacl-form>, that
// no un-guarded fetch leaves the wrapper for a `remote` source, that a hostile
// data graph + an EMPTY shapes graph triggers ZERO fetches, and that an empty
// shapes graph fails closed (no <shacl-form> mounted).
//
// NO DECORATORS: reactive props are declared via `static properties` + `declare`
// + constructor assignment (the suite convention from @jeswr/solid-elements). With
// `useDefineForClassFields: true`, a class-field initializer would SHADOW Lit's
// reactive accessor — the declarative form sidesteps that footgun and avoids the
// standard-decorator transpile that tripped a runtime token error under vitest.

// Side-effect import: registers the inner <shacl-form> custom element. The
// committed dist/ inlines this (esbuild), so a GitHub-branch install needs no
// shacl-form peer install (the §8 self-contained-dist contract).
import "@ulb-darmstadt/shacl-form";
import { html, LitElement, nothing, type PropertyValues } from "lit";
import {
  type FetchSeam,
  type GraphSource,
  type ResolveOptions,
  resolveAndHarden,
} from "../shacl-view-fetch.js";

/** The status of the view's current render attempt. */
type ViewStatus = "idle" | "loading" | "ready" | "error";

/** The set of `data-*` dataset keys this wrapper is allowed to set on <shacl-form>. */
const ALLOWED_DATASET_KEYS = new Set([
  "view",
  "ignoreOwlImports",
  "shapes",
  "values",
  "shapeSubject",
  // `data-values-subject` (camelCase `valuesSubject`): the auto-import suppressant
  // — pinning it stops shacl-form auto-deriving a fetchable subject from the data.
  "valuesSubject",
]);

/** The reactive INPUT properties (changing any re-resolves the graphs). */
const INPUT_PROPS = ["shapes", "values", "shapeSubject", "fetch", "publicFetch", "resolveOptions"];

/**
 * A read-only SHACL view. Drive it imperatively (the codegen-friendly path):
 *
 *   const el = document.createElement("jeswr-shacl-view");
 *   el.fetch = session.fetch;          // the user's authenticated fetch
 *   el.publicFetch = pristineFetch;    // the credential-free fetch
 *   el.shapes = { kind: "inline", text: shapesTurtle };
 *   el.values = { kind: "trusted", url: resourceUrl, seam: "auth" };
 *   document.body.append(el);
 *
 * Setting `.shapes` / `.values` / a fetch triggers a re-render. The wrapper never
 * exposes a `*-url` attribute and never lets shacl-form fetch.
 *
 * @csspart form  - The inner <shacl-form> element (read-only view).
 * @csspart error - The error message shown when a graph fails to load/parse.
 * @csspart empty - Placeholder shown when no shape/data is set.
 * @csspart loading - Placeholder shown while graphs are being pre-fetched.
 */
export class JeswrShaclView extends LitElement {
  static properties = {
    shapes: { attribute: false },
    values: { attribute: false },
    shapeSubject: { attribute: "shape-subject" },
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    resolveOptions: { attribute: false },
    status: { state: true },
    errorMessage: { state: true },
    shapesTurtle: { state: true },
    valuesTurtle: { state: true },
  };

  /** The SHACL shapes graph source. Required before anything renders. */
  declare shapes: GraphSource | undefined;
  /** The data graph source to render against the shapes. Required to render. */
  declare values: GraphSource | undefined;
  /**
   * Optionally pin which node shape to render (shacl-form's `data-shape-subject`).
   * A plain string IRI — set on the inner element verbatim, NOT a URL to fetch.
   */
  declare shapeSubject: string | undefined;
  /** The session-bound authenticated fetch (for `trusted`+`auth` sources). */
  declare fetch: typeof fetch | undefined;
  /** The pristine credential-free fetch (for `trusted`+`public` sources). */
  declare publicFetch: typeof fetch | undefined;
  /**
   * Resolver options forwarded to the pre-fetch (max bytes / timeout / a test
   * loader stub for guarded-fetch). Never includes a fetch — those come from the
   * seam properties above so the credential boundary stays explicit.
   */
  declare resolveOptions: ResolveOptions | undefined;

  private declare status: ViewStatus;
  private declare errorMessage: string;
  private declare shapesTurtle: string;
  private declare valuesTurtle: string;

  /** A monotonically increasing token to drop the result of a superseded resolve. */
  #renderToken = 0;

  constructor() {
    super();
    // Defaults in the constructor (NOT field initializers) so they do not shadow
    // Lit's reactive accessors under useDefineForClassFields.
    this.shapes = undefined;
    this.values = undefined;
    this.shapeSubject = undefined;
    this.fetch = undefined;
    this.publicFetch = undefined;
    this.resolveOptions = undefined;
    this.status = "idle";
    this.errorMessage = "";
    this.shapesTurtle = "";
    this.valuesTurtle = "";
  }

  /** Render into the light DOM so a consuming app can `::part`/style the inner form. */
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    // Re-resolve whenever an INPUT changed (not when our own derived state did,
    // else we'd loop). The seam fetches + the sources are the inputs.
    const changedKeys = changed as unknown as Map<string, unknown>;
    if (INPUT_PROPS.some((k) => changedKeys.has(k))) {
      void this.#resolve();
    }
  }

  /**
   * Pre-fetch + serialise both graphs, then drop them into state so render()
   * inlines them onto <shacl-form>. Fail-closed: any error → the error view, with
   * no partially-applied inline graph.
   */
  async #resolve(): Promise<void> {
    // Increment the token FIRST, unconditionally — this INVALIDATES any prior
    // in-flight resolve. Otherwise, clearing `shapes`/`values` mid-flight would
    // take the early-idle return WITHOUT bumping the token, and the older resolve
    // could still complete and set status="ready" with stale data (a stale-render
    // race). Every resolve (incl. the idle one) supersedes the previous.
    const token = ++this.#renderToken;
    const shapes = this.shapes;
    const values = this.values;
    if (!shapes || !values) {
      // Back to idle: drop any previously-rendered graph so a later render can't
      // show stale inline data.
      this.shapesTurtle = "";
      this.valuesTurtle = "";
      this.errorMessage = "";
      this.status = "idle";
      return;
    }
    this.status = "loading";
    this.errorMessage = "";

    // CREDENTIAL BOUNDARY (fail-closed). The `fetch` (auth / default) path may
    // fall back to the global fetch — that path is allowed to be authenticated.
    // But `publicFetch` has NO fallback: it is passed through as-is (possibly
    // undefined), and the resolver THROWS for a `{ seam: "public" }` source when it
    // is missing — rather than silently using `this.fetch` OR a `globalThis.fetch`
    // that auth code may already have patched to carry credentials. So a public
    // read can never leak the session token; the caller must set `.publicFetch`.
    const seam: FetchSeam = {
      fetch: this.fetch ?? globalThis.fetch.bind(globalThis),
      ...(this.publicFetch ? { publicFetch: this.publicFetch } : {}),
    };
    const opts = this.resolveOptions ?? {};

    // §9 — resolve + harden through the SHARED pipeline (the SAME function the
    // editable <jeswr-shacl-form> calls, so the view + edit form cannot drift on the
    // SSRF discipline). It NEVER throws: it returns a `kind` for each outcome —
    // `ready` (mount with the inline strings), `empty-shapes` (fix 1, fail closed),
    // or `error`. fix (1) empty-shapes fail-close + fix (2) values-neutralisation
    // happen inside it; this element keeps the `data-view` / no-`*-url` discipline
    // (its template + updated()), which is element-specific.
    const result = await resolveAndHarden(shapes, values, seam, opts);
    if (token !== this.#renderToken) return; // a newer resolve superseded us.

    if (result.kind === "ready") {
      this.shapesTurtle = result.shapesTurtle;
      this.valuesTurtle = result.valuesTurtle;
      this.status = "ready";
      return;
    }
    // empty-shapes (fix 1) + error both render the error state with NO inline graph,
    // so a mounted <shacl-form> never sees an empty shapes graph or partial data.
    this.shapesTurtle = "";
    this.valuesTurtle = "";
    this.errorMessage = result.message;
    this.status = "error";
  }

  protected override render() {
    if (this.status === "idle") {
      return html`<slot name="empty"><p part="empty">No shape or data to display.</p></slot>`;
    }
    if (this.status === "loading") {
      return html`<slot name="loading"><p part="loading">Loading…</p></slot>`;
    }
    if (this.status === "error") {
      // Lit text interpolation escapes — never innerHTML.
      return html`<p part="error" role="alert">${this.errorMessage}</p>`;
    }

    // status === "ready" — render the inner <shacl-form> in VIEW mode with INLINE
    // graphs. CRITICAL: only INLINE `data-shapes` / `data-values` are bound; there
    // is NO `data-shapes-url` / `data-values-url` anywhere. `data-view` and
    // `data-ignore-owl-imports` are ALWAYS present (empty string ⇒ non-null ⇒
    // "set" to shacl-form). `data-shape-subject` (a plain IRI string) is applied
    // in updated() after render, never as a fetch URL.
    // §9 fix (3) — the auto-import branch (which follows a derived values subject)
    // is closed by fix (1): for a MOUNTED form the shapes graph is non-empty
    // (fix 1 fail-closes otherwise), so the auto-import branch's
    // `countQuads(loaded-shapes) === 0` precondition is false and the derived
    // subject is never FOLLOWED to an unguarded fetch. (Execution-verified vs the
    // real upstream `loadGraphs`.) shacl-form may still auto-DERIVE a values
    // subject from a benign `dct:conformsTo` (e.g. a `urn:` profile reference) — and
    // that is DESIRABLE: it lets the instance render against its own data (its
    // `rdf:type`, which we keep, selects the matching shape). We DELIBERATELY do NOT
    // pin a foreign `data-values-subject` SENTINEL here: shacl-form renders the shape
    // bound to `valuesSubject` (`new ShapeTemplate(root, namedNode(valuesSubject))`),
    // so a sentinel that is not a real subject in the data would render an EMPTY
    // view (verified against the shacl-form source). Leaving it UNSET lets
    // shacl-form render against the derived subject (or `void 0` = all target nodes
    // when none is derived). fix (2) still strips the http(s) `conformsTo` import
    // vector as defence-in-depth. (`VALUES_SUBJECT_SENTINEL` is exported from
    // shacl-view-fetch for callers who want to pin it on an empty/placeholder view.)
    return html`
      <shacl-form
        part="form"
        data-view=""
        data-ignore-owl-imports=""
        data-shapes=${this.shapesTurtle}
        data-values=${this.valuesTurtle}
        data-shape-subject=${this.shapeSubject ?? nothing}
      ></shacl-form>
    `;
  }

  /**
   * Defence-in-depth: after every render, REMOVE any `*-url` dataset key from the
   * inner <shacl-form> that might somehow have appeared, and any key not on the
   * allow-list. This is belt-and-braces over the template (which already only
   * binds inline keys) so a future template edit cannot silently re-introduce a
   * URL fetch surface.
   */
  protected override updated(_changed: PropertyValues<this>): void {
    const form = this.querySelector("shacl-form") as HTMLElement | null;
    if (!form) return;
    for (const key of Object.keys(form.dataset)) {
      const lower = key.toLowerCase();
      if (lower.endsWith("url") || !ALLOWED_DATASET_KEYS.has(key)) {
        delete form.dataset[key];
      }
    }
  }
}

// Guarded registration (idempotent — a double import / double load is safe).
if (!customElements.get("jeswr-shacl-view")) {
  customElements.define("jeswr-shacl-view", JeswrShaclView);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-shacl-view": JeswrShaclView;
  }
}
