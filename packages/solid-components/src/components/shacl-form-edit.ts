// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-shacl-form> — the EDITABLE (edit-mode) Lit element wrapping
// @ulb-darmstadt/shacl-form. It is the write-path sibling of the read-only
// <jeswr-shacl-view>: same SSRF discipline, but it lets the user EDIT the data and
// SAVES through a suite-owned §10 MERGE-NOT-REPLACE write (the DataWriter), never a
// naive `toRDF() → PUT`.
//
// §9 SSRF DISCIPLINE — IDENTICAL to <jeswr-shacl-view>, by sharing ONE pipeline:
//   - It resolves + hardens both graphs through `resolveAndHarden` (shacl-view-
//     fetch.ts) — the EXACT function the read view calls. So fix (1) (FAIL CLOSED on
//     an empty resolved shapes graph — the auto-import SSRF closer) and fix (2)
//     (NEUTRALISE the untrusted values graph: drop `dct:conformsTo`→http(s), KEEP
//     `rdf:type`) apply here verbatim; the edit form CANNOT drift from the view.
//   - It NEVER sets shacl-form's `data-shapes-url` / `data-values-url` (giving
//     shacl-form a URL would let IT fetch, unguarded). It pre-fetches + inlines.
//   - It ALWAYS sets `data-ignore-owl-imports` (closes the owl:imports fetch path).
//   - It does NOT set `data-view` (its ABSENCE is what makes shacl-form EDITABLE —
//     shacl-form's `editMode = data-view === null`). This is the one deliberate
//     difference from the view, and the reason the element exists.
//   - The same `updated()` belt-and-braces strips any `*-url` dataset key that ever
//     appears on the inner <shacl-form> + any key off the allow-list.
//
// THE SAVE IS §10 MERGE-NOT-REPLACE (the correctness invariant — NOT a toRDF()→PUT):
// shacl-form's `toRDF()` emits ONLY the shaped node's triples, so a naive
// `toRDF() → PUT` (a) DROPS every triple outside the shape and (b) clobbers the
// dual-predicate federation compat (e.g. a task writes BOTH wf:description +
// dct:description). So save() delegates to a caller-supplied `mergeSave` callback
// that runs through the DataWriter's §10 path: LOAD the existing graph (keep ETag) →
// apply the form's edited values via the MODEL's typed accessor onto that loaded
// graph (only the shape-covered predicates change; untouched triples preserved) →
// conditional `If-Match` PUT. The per-class form components (jeswr-task-form etc.)
// wire that callback; this base element owns the SSRF-safe mounting, the optimistic
// saving/saved/error STATE, and revert-on-failure — never the raw triple handling.
//
// CLIENT-SIDE VALIDATION IS UX, NOT AUTHZ: shacl-form's validate() runs advisory —
// a failing validation WARNS but never BLOCKS the save (authorization is the
// server's WAC + SHACL job; a client SHACL pass is a convenience, and blocking on it
// would let a stale/partial client shape lock a user out of their own data). The
// component surfaces validation warnings; it does not gate the write on them.
//
// NO DECORATORS: same rationale as <jeswr-shacl-view> — `static properties` +
// `declare` + constructor assignment (a class-field initializer would shadow Lit's
// reactive accessor under useDefineForClassFields).

import "@ulb-darmstadt/shacl-form";
import { html, LitElement, nothing, type PropertyValues } from "lit";
import type { Store } from "n3";
import type { SaveStatus } from "../data-writer.js";
import {
  type FetchSeam,
  type GraphSource,
  type ResolveOptions,
  resolveAndHarden,
} from "../shacl-view-fetch.js";

/** The shacl-form element surface this wrapper drives (toRDF + validate). */
interface ShaclFormElement extends HTMLElement {
  toRDF(): Store;
  validate(ignoreEmptyValues?: boolean): Promise<{ conforms: boolean; results: unknown[] }>;
}

/** The status of the form's current resolve/render attempt. */
type FormStatus = "idle" | "loading" | "ready" | "error";

/**
 * The save callback a per-class form (or a consumer) supplies. It is handed the
 * EDITED shaped-node graph from shacl-form's `toRDF()` (only the shape's triples)
 * and must perform the §10 MERGE write — load the existing resource, apply the delta
 * through the model's typed accessors onto it (preserving untouched triples +
 * honouring dual-predicate), and conditionally PUT. Returning rejects → the form
 * shows the error + reverts the optimistic state. This element NEVER does the merge
 * itself (it would have to hand-handle triples); it owns only the mounting + state.
 */
export type MergeSaveCallback = (formGraph: Store) => Promise<void>;

/** The detail of the `jeswr-save` / `jeswr-save-error` events the element fires. */
export interface SaveEventDetail {
  /** The shaped-node graph shacl-form produced (the form's toRDF() output). */
  readonly formGraph: Store;
  /** A client-side SHACL validation report (advisory — the save is not gated on it). */
  readonly conforms: boolean;
}

/** The dataset keys this wrapper is allowed to set on the inner <shacl-form>. */
const ALLOWED_DATASET_KEYS = new Set([
  // NOTE: NO "view" key here — its ABSENCE is what makes shacl-form editable.
  "ignoreOwlImports",
  "shapes",
  "values",
  "shapeSubject",
  "valuesSubject",
]);

/** The reactive INPUTS that re-resolve the graphs when changed. */
const INPUT_PROPS = ["shapes", "values", "shapeSubject", "fetch", "publicFetch", "resolveOptions"];

/**
 * An EDITABLE SHACL form. Drive it imperatively:
 *
 *   const el = document.createElement("jeswr-shacl-form");
 *   el.fetch = session.fetch;          // the user's authenticated fetch
 *   el.shapes = { kind: "inline", text: shapesTurtle };
 *   el.values = { kind: "trusted", url: resourceUrl, seam: "auth" };
 *   el.mergeSave = async (formGraph) => { ...§10 merge write... };
 *   document.body.append(el);
 *   // user edits, then:
 *   await el.save();
 *
 * @csspart form    - The inner editable <shacl-form>.
 * @csspart actions - The save-button row.
 * @csspart save    - The save <button>.
 * @csspart status  - The saving/saved/error indicator.
 * @csspart warning - The advisory client-validation warning.
 * @csspart error   - The error message shown when a graph fails to load/parse.
 * @csspart empty   - Placeholder shown when no shape/data is set.
 * @csspart loading - Placeholder shown while graphs are being pre-fetched.
 *
 * @fires jeswr-save       - after a successful save (detail: SaveEventDetail).
 * @fires jeswr-save-error - after a failed save (detail: { error }).
 */
export class JeswrShaclForm extends LitElement {
  static properties = {
    shapes: { attribute: false },
    values: { attribute: false },
    shapeSubject: { attribute: "shape-subject" },
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    resolveOptions: { attribute: false },
    mergeSave: { attribute: false },
    showSaveButton: { type: Boolean, attribute: "show-save-button" },
    status: { state: true },
    saveStatus: { state: true },
    errorMessage: { state: true },
    saveErrorMessage: { state: true },
    validationWarning: { state: true },
    shapesTurtle: { state: true },
    valuesTurtle: { state: true },
  };

  /** The SHACL shapes graph source. Required before anything renders. */
  declare shapes: GraphSource | undefined;
  /** The data graph source to edit against the shapes. Required to render. */
  declare values: GraphSource | undefined;
  /** Optionally pin which node shape to edit (shacl-form's `data-shape-subject`). */
  declare shapeSubject: string | undefined;
  /** The session-bound authenticated fetch (for `trusted`+`auth` sources). */
  declare fetch: typeof fetch | undefined;
  /** The pristine credential-free fetch (for `trusted`+`public` sources). */
  declare publicFetch: typeof fetch | undefined;
  /** Resolver options forwarded to the pre-fetch (max bytes / timeout / test stub). */
  declare resolveOptions: ResolveOptions | undefined;
  /**
   * The §10 merge-save callback. When set, {@link JeswrShaclForm.save} delegates to
   * it (the per-class forms wire it to a DataWriter merge). When UNSET, `save()`
   * throws — this base element refuses to do a naive write itself.
   */
  declare mergeSave: MergeSaveCallback | undefined;
  /** Whether to render the built-in save button (default true). */
  declare showSaveButton: boolean;

  private declare status: FormStatus;
  private declare saveStatus: SaveStatus;
  private declare errorMessage: string;
  private declare saveErrorMessage: string;
  private declare validationWarning: string;
  private declare shapesTurtle: string;
  private declare valuesTurtle: string;

  /** A monotonically increasing token to drop the result of a superseded resolve. */
  #renderToken = 0;
  /** A monotonically increasing token so a stale save can't flip a newer one's state. */
  #saveToken = 0;

  constructor() {
    super();
    this.shapes = undefined;
    this.values = undefined;
    this.shapeSubject = undefined;
    this.fetch = undefined;
    this.publicFetch = undefined;
    this.resolveOptions = undefined;
    this.mergeSave = undefined;
    this.showSaveButton = true;
    this.status = "idle";
    this.saveStatus = "idle";
    this.errorMessage = "";
    this.saveErrorMessage = "";
    this.validationWarning = "";
    this.shapesTurtle = "";
    this.valuesTurtle = "";
  }

  /** Light DOM so a consuming app can `::part`/style the inner form. */
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    const changedKeys = changed as unknown as Map<string, unknown>;
    if (INPUT_PROPS.some((k) => changedKeys.has(k))) {
      void this.#resolve();
    }
  }

  /**
   * Pre-fetch + §9-harden both graphs through the SHARED pipeline (the SAME one the
   * read view uses). Fail-closed: empty shapes / any error → the error view with no
   * partially-applied inline graph, so a mounted <shacl-form> never sees bad input.
   */
  async #resolve(): Promise<void> {
    // Bump the token FIRST, unconditionally, so clearing inputs mid-flight supersedes
    // a prior in-flight resolve (the stale-render-race fix, mirrored from the view).
    const token = ++this.#renderToken;
    const shapes = this.shapes;
    const values = this.values;
    if (!shapes || !values) {
      this.shapesTurtle = "";
      this.valuesTurtle = "";
      this.errorMessage = "";
      this.status = "idle";
      return;
    }
    this.status = "loading";
    this.errorMessage = "";
    this.validationWarning = "";

    // CREDENTIAL BOUNDARY (fail-closed) — identical to the view: `fetch` may fall
    // back to the global; `publicFetch` has NO fallback (the resolver throws for a
    // `{ seam: "public" }` source without it), so a public read never leaks the token.
    const seam: FetchSeam = {
      fetch: this.fetch ?? globalThis.fetch.bind(globalThis),
      ...(this.publicFetch ? { publicFetch: this.publicFetch } : {}),
    };
    const opts = this.resolveOptions ?? {};

    const result = await resolveAndHarden(shapes, values, seam, opts);
    if (token !== this.#renderToken) return; // a newer resolve superseded us.

    if (result.kind === "ready") {
      this.shapesTurtle = result.shapesTurtle;
      this.valuesTurtle = result.valuesTurtle;
      this.status = "ready";
      return;
    }
    this.shapesTurtle = "";
    this.valuesTurtle = "";
    this.errorMessage = result.message;
    this.status = "error";
  }

  /**
   * SAVE — the §10 merge write. Reads the edited graph from shacl-form (`toRDF()` —
   * only the shaped node's triples), runs an ADVISORY client validation (warn,
   * never block), then delegates the actual write to {@link JeswrShaclForm.mergeSave}
   * (the per-class forms wire a DataWriter §10 merge). Optimistic state:
   * saving → saved on success, → error + a surfaced message on failure (revert).
   *
   * @returns `true` on a successful save, `false` on failure (the error is on the
   *   element's status + the `jeswr-save-error` event).
   * @throws if there is no mounted form, or no `mergeSave` callback (the base element
   *   refuses to do a naive write — that would drop triples / break dual-predicate).
   */
  async save(): Promise<boolean> {
    const form = this.querySelector("shacl-form") as ShaclFormElement | null;
    if (!form) {
      throw new Error("Cannot save: the editable form is not ready (no inner <shacl-form>).");
    }
    if (!this.mergeSave) {
      throw new Error(
        "Cannot save: no `mergeSave` callback is set. The editable form refuses a naive write " +
          "(it would drop triples outside the shape + break dual-predicate compat). Use a " +
          "per-class form (jeswr-task-form/…) or set `.mergeSave` to a DataWriter §10 merge.",
      );
    }

    // Read the edited shaped-node graph (the form's delta — only the shape's triples).
    const formGraph = form.toRDF();

    // ADVISORY client validation — surfaces a warning, NEVER gates the save. Client
    // SHACL is UX, not authz (the server's WAC + SHACL are authoritative). A
    // validate() throw is itself non-fatal (we still save).
    let conforms = true;
    try {
      const report = await form.validate(true);
      conforms = report.conforms;
      this.validationWarning = report.conforms
        ? ""
        : "Some fields don't satisfy the shape. Saving anyway (validation is advisory).";
    } catch {
      // A validation engine error is advisory too — do not block the save.
      this.validationWarning = "";
    }

    const token = ++this.#saveToken;
    this.saveStatus = "saving";
    this.saveErrorMessage = "";
    try {
      await this.mergeSave(formGraph);
      if (token !== this.#saveToken) return true; // a newer save superseded us.
      this.saveStatus = "saved";
      this.#emit("jeswr-save", { formGraph, conforms });
      return true;
    } catch (error) {
      if (token !== this.#saveToken) return false; // superseded — don't flip state.
      // Revert-on-failure: surface the error; the in-form edits remain so the user
      // can retry. (No external state was optimistically mutated here — the merge
      // write is the only mutation, and on failure it left the server unchanged: the
      // conditional PUT is atomic, so a 412/transport error means nothing was written.)
      this.saveStatus = "error";
      this.saveErrorMessage = error instanceof Error ? error.message : String(error);
      this.#emit("jeswr-save-error", { error });
      return false;
    }
  }

  /** Fire a CustomEvent (composed so a consuming app outside the light DOM hears it). */
  #emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  protected override render() {
    if (this.status === "idle") {
      return html`<slot name="empty"><p part="empty">No shape or data to edit.</p></slot>`;
    }
    if (this.status === "loading") {
      return html`<slot name="loading"><p part="loading">Loading…</p></slot>`;
    }
    if (this.status === "error") {
      return html`<p part="error" role="alert">${this.errorMessage}</p>`;
    }

    // status === "ready" — mount the inner <shacl-form> in EDIT mode with INLINE
    // graphs. CRITICAL §9 invariants, identical to the view EXCEPT data-view:
    //   - INLINE data-shapes / data-values only — NEVER data-shapes-url/-values-url.
    //   - data-ignore-owl-imports ALWAYS set (owl:imports fetch path closed).
    //   - data-view is DELIBERATELY ABSENT → shacl-form is EDITABLE. (Its presence
    //     in the view is what makes the view read-only; its absence here is the one
    //     intended difference.)
    return html`
      <shacl-form
        part="form"
        data-ignore-owl-imports=""
        data-shapes=${this.shapesTurtle}
        data-values=${this.valuesTurtle}
        data-shape-subject=${this.shapeSubject ?? nothing}
      ></shacl-form>
      ${this.validationWarning ? html`<p part="warning" role="status">${this.validationWarning}</p>` : null}
      ${this.#renderActions()}
    `;
  }

  /** The save button + the saving/saved/error indicator. */
  #renderActions() {
    if (!this.showSaveButton) {
      return this.saveStatus === "idle" ? null : this.#statusIndicator();
    }
    return html`
      <div part="actions">
        <button
          part="save"
          type="button"
          ?disabled=${this.saveStatus === "saving"}
          @click=${() => void this.save()}
        >
          ${this.saveStatus === "saving" ? "Saving…" : "Save"}
        </button>
        ${this.#statusIndicator()}
      </div>
    `;
  }

  /** The non-button saving/saved/error text (escaped — Lit text interpolation). */
  #statusIndicator() {
    if (this.saveStatus === "saved") {
      return html`<span part="status" data-state="saved" role="status">Saved</span>`;
    }
    if (this.saveStatus === "error") {
      return html`<span part="status" data-state="error" role="alert"
        >${this.saveErrorMessage || "Save failed"}</span
      >`;
    }
    if (this.saveStatus === "saving") {
      return html`<span part="status" data-state="saving" role="status">Saving…</span>`;
    }
    return null;
  }

  /**
   * Belt-and-braces (identical to the view): after every render, REMOVE any `*-url`
   * dataset key or any key off the allow-list from the inner <shacl-form>, so a
   * future template edit can never silently re-introduce a fetch-URL surface. ALSO
   * asserts data-view is never set here (the edit form must stay editable).
   */
  protected override updated(_changed: PropertyValues<this>): void {
    const form = this.querySelector("shacl-form") as HTMLElement | null;
    if (!form) return;
    for (const key of Object.keys(form.dataset)) {
      const lower = key.toLowerCase();
      // Strip any URL-fetch key, any key off the allow-list, AND `view` (which would
      // turn the form read-only — never wanted on the EDIT element).
      if (lower.endsWith("url") || key === "view" || !ALLOWED_DATASET_KEYS.has(key)) {
        delete form.dataset[key];
      }
    }
  }
}

if (!customElements.get("jeswr-shacl-form")) {
  customElements.define("jeswr-shacl-form", JeswrShaclForm);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-shacl-form": JeswrShaclForm;
  }
}
