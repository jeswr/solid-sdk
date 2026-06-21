// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Shared scaffolding for the per-class EDITABLE form components (jeswr-task-form /
// jeswr-contact-form / jeswr-bookmark-form). Each per-class form is a thin
// projection over the editable <jeswr-shacl-form> base element + its model:
//
//   1. It supplies the model's SHACL SHAPE (inline Turtle from the model's shape
//      file) + the existing resource as the data graph (a `trusted`+`auth` source),
//      so <jeswr-shacl-form> renders an editable form bound to the user's data —
//      reusing the EXACT §9 SSRF hardening (`resolveAndHarden`) that the read view
//      uses (it CANNOT drift).
//   2. It wires the §10 MERGE-NOT-REPLACE save: a `mergeSave` callback that, given
//      the form's edited shaped-node graph (shacl-form's `toRDF()` — only the
//      shape's triples), runs `DataWriter.saveMerged(url, mutator)`. The mutator
//      reads the edited values out of the form graph through the MODEL's `parse*`
//      and applies them to the LOADED existing graph through the MODEL's typed
//      `Task`/`Contact`/`Bookmark` setters — so only the shape-covered predicates
//      change (incl. dual-predicate writes like wf:description + dct:description),
//      every untouched triple is preserved, and no quad is hand-built.
//
// This base owns the wiring + the credential/scope seams; each subclass supplies
// only: the shape Turtle, the model's parse-from-form-graph, and the model's
// apply-to-existing-graph (both via the typed model APIs). The save NEVER touches
// raw triples here.

import { html, LitElement, type TemplateResult } from "lit";
import type { Store } from "n3";
import { DataWriter, type SaveStatus, type WriteSeam } from "../data-writer.js";
import type { GraphSource, ResolveOptions } from "../shacl-view-fetch.js";
import "./shacl-form-edit.js";
import type { JeswrShaclForm, MergeSaveCallback, SaveEventDetail } from "./shacl-form-edit.js";

/** The input props the base re-renders the editable form on. */
export const BASE_FORM_INPUT_PROPS = [
  "src",
  "fetch",
  "publicFetch",
  "base",
  "resolveOptions",
] as const;

/**
 * Base class for the per-class editable form elements. It mounts the inner
 * <jeswr-shacl-form> (the §9-hardened editable wrapper) bound to the model's shape +
 * the resource at `src`, and wires the §10 merge save. A subclass implements:
 *   - {@link shapeTurtle}: the model's SHACL shape, as inline Turtle.
 *   - {@link applyFormDeltaToExisting}: read the edited values from the form graph
 *     (via the model's `parse*`) and apply them to the LOADED existing graph (via the
 *     model's typed setters). MUST go through the model's typed accessors — no quad
 *     hand-built. Mutates the existing graph in place (or returns a Store).
 */
export abstract class AbstractFormElement extends LitElement {
  /** The resource URL to edit. Setting it (re)renders the bound form. */
  declare src: string | undefined;
  /** The session-bound authenticated fetch (used for BOTH the read + the §10 write). */
  declare fetch: typeof fetch | undefined;
  /** The credential-free fetch for a public/foreign DATA read (rare for an editor). */
  declare publicFetch: typeof fetch | undefined;
  /**
   * The base URL writes are confined to (the DataWriter scope guard). Defaults to
   * the resource's own directory when unset, so a save can never leave the edited
   * resource's container.
   */
  declare base: string | undefined;
  /** Resolver options forwarded to the §9 pre-fetch (max bytes / timeout / test stub). */
  declare resolveOptions: ResolveOptions | undefined;

  protected declare saveStatus: SaveStatus;

  static properties = {
    src: {},
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    base: {},
    resolveOptions: { attribute: false },
    saveStatus: { state: true },
  };

  constructor() {
    super();
    this.src = undefined;
    this.fetch = undefined;
    this.publicFetch = undefined;
    this.base = undefined;
    this.resolveOptions = undefined;
    this.saveStatus = "idle";
  }

  /** Light DOM so a consuming app can `::part`/style the inner editable form. */
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  /** The model's SHACL shape graph as inline Turtle. */
  protected abstract shapeTurtle(): string;

  /**
   * Apply the form's edited values to the LOADED existing graph through the model's
   * TYPED accessors. `formGraph` is shacl-form's `toRDF()` output (only the shaped
   * node's triples); `existing` is the loaded resource graph (every existing triple
   * intact). Read the edited values from `formGraph` via the model's `parse*`, then
   * write them onto `existing` via the model's typed setters — so only the shape's
   * predicates change, dual-predicate writes happen, and untouched triples survive.
   * MUST NOT hand-build a quad. Mutates `existing` in place (return is optional).
   */
  protected abstract applyFormDeltaToExisting(
    formGraph: Store,
    existing: Store,
    resourceUrl: string,
  ): void | Promise<void>;

  /**
   * The §10 merge-save callback handed to <jeswr-shacl-form>. Builds a DataWriter
   * scoped to `base` (or the resource directory) and runs `saveMerged`, whose mutator
   * delegates to the subclass's {@link applyFormDeltaToExisting} on the LOADED graph.
   */
  protected mergeSaveCallback(): MergeSaveCallback {
    return async (formGraph: Store) => {
      const src = this.src;
      if (!src) throw new Error("Cannot save: no `src` resource is set.");
      const seam: WriteSeam = {
        ...(this.fetch ? { fetch: this.fetch } : {}),
        // Default the scope-guard base to the resource's own directory so a save can
        // never leave the edited resource's container even if `base` is unset.
        base: this.base ?? defaultBaseFor(src),
      };
      const writer = new DataWriter(seam);
      await writer.saveMerged(src, async (existing, resourceUrl) => {
        // The subclass mutates `existing` IN PLACE through the model's typed setters,
        // so the mutator returns `undefined` (saveMerged then writes `existing`).
        await this.applyFormDeltaToExisting(formGraph, existing, resourceUrl);
        return undefined;
      });
    };
  }

  /** Build the data-graph source for the inner form: the resource, read with `fetch`. */
  protected dataSource(): GraphSource | undefined {
    return this.src ? { kind: "trusted", url: this.src, seam: "auth" } : undefined;
  }

  /** Forward a child <jeswr-shacl-form>'s save state up so this element can reflect it. */
  #onChildState = (): void => {
    const form = this.querySelector("jeswr-shacl-form") as JeswrShaclForm | null;
    // jeswr-shacl-form keeps its own saveStatus as Lit state (not reflected); mirror
    // it best-effort for consumers that read THIS element's saveStatus.
    if (form)
      this.saveStatus = (form as unknown as { saveStatus?: SaveStatus }).saveStatus ?? "idle";
  };

  /** Imperatively trigger a save on the inner editable form. */
  async save(): Promise<boolean> {
    const form = this.querySelector("jeswr-shacl-form") as JeswrShaclForm | null;
    if (!form) throw new Error("Cannot save: the editable form is not ready.");
    const ok = await form.save();
    this.#onChildState();
    return ok;
  }

  protected override render(): TemplateResult {
    if (!this.src) {
      return html`<slot name="empty"><p part="empty">No resource to edit.</p></slot>`;
    }
    const dataSource = this.dataSource();
    return html`
      <jeswr-shacl-form
        part="form"
        .shapes=${{ kind: "inline", text: this.shapeTurtle() } as GraphSource}
        .values=${dataSource}
        .fetch=${this.fetch}
        .publicFetch=${this.publicFetch}
        .resolveOptions=${this.resolveOptions}
        .mergeSave=${this.mergeSaveCallback()}
        @jeswr-save=${(e: CustomEvent<SaveEventDetail>) => this.#onSave(e)}
        @jeswr-save-error=${() => this.#onChildState()}
      ></jeswr-shacl-form>
    `;
  }

  /** Re-emit the inner form's save as this element's own event + mirror the state. */
  #onSave(e: CustomEvent<SaveEventDetail>): void {
    this.#onChildState();
    this.dispatchEvent(
      new CustomEvent("jeswr-save", { detail: e.detail, bubbles: true, composed: true }),
    );
  }
}

/**
 * The default DataWriter scope base for a resource: its containing directory (the
 * path up to + including the last `/`). So a save of `…/tasks/1` is confined to
 * `…/tasks/`. Falls back to the resource origin on a parse failure (still
 * same-origin-confined). Pure; no network.
 */
export function defaultBaseFor(resourceUrl: string): string {
  try {
    const u = new URL(resourceUrl);
    const dir = u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1) || "/";
    return `${u.origin}${dir}`;
  } catch {
    return resourceUrl;
  }
}

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** A minimal n3-Store read surface for the subject scan (avoids importing n3 here). */
interface QuadScanStore {
  getQuads(
    subject: unknown,
    predicate: unknown,
    object: unknown,
    graph: unknown,
  ): { subject: { termType: string; value: string } }[];
}

/**
 * Find the EDITED subject in shacl-form's `toRDF()` form graph — the node whose
 * field values the merge reads. shacl-form in EDIT mode binds the form to a subject
 * that is NOT necessarily the resource's conventional subject (it commonly MINTS a
 * fresh IRI, observed under the real upstream), so we must locate the form's typed
 * subject rather than assume `${url}#it`. Returns the first NamedNode subject typed
 * with `typeIri` in the form graph, preferring `conventional` if IT is the typed one,
 * else `conventional` as a last resort (an empty form graph). A direct quad scan
 * (existence query — no triple built), via a `namedNode` factory so the n3 term
 * construction lives at the call site (each form imports n3's DataFactory once).
 *
 * IMPORTANT — this is the READ subject (in the form graph). The merge WRITES onto the
 * resource's `conventional` subject in the EXISTING graph (so the saved triples land
 * on `${url}#it`/`#this`, not on shacl-form's minted IRI). See each per-class form.
 *
 * @param formGraph    - shacl-form's toRDF() output.
 * @param typeIri      - the model class IRI (wf:Task / vcard:Individual / book:Bookmark).
 * @param conventional - the model's conventional subject for `src` (`#it` / `#this`).
 * @param namedNode    - the n3 DataFactory.namedNode (passed in by the subclass).
 */
export function findEditedSubject(
  formGraph: QuadScanStore,
  typeIri: string,
  conventional: string,
  namedNode: (value: string) => unknown,
): string {
  const rdfType = namedNode(RDF_TYPE);
  const typeNode = namedNode(typeIri);
  // Prefer the conventional subject IF the form graph typed it (a form that kept the
  // resource subject) — its values land directly without a re-key.
  if (formGraph.getQuads(namedNode(conventional), rdfType, typeNode, null).length > 0) {
    return conventional;
  }
  // Else the first typed subject in the form graph (shacl-form's bound/minted node).
  for (const q of formGraph.getQuads(null, rdfType, typeNode, null)) {
    if (q.subject.termType === "NamedNode") return q.subject.value;
  }
  return conventional;
}
