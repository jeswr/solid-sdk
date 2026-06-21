import { LitElement, type TemplateResult } from "lit";
import type { Store } from "n3";
import { type SaveStatus } from "../data-writer.js";
import type { GraphSource, ResolveOptions } from "../shacl-view-fetch.js";
import "./shacl-form-edit.js";
import type { MergeSaveCallback } from "./shacl-form-edit.js";
/** The input props the base re-renders the editable form on. */
export declare const BASE_FORM_INPUT_PROPS: readonly ["src", "fetch", "publicFetch", "base", "resolveOptions"];
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
export declare abstract class AbstractFormElement extends LitElement {
    #private;
    /** The resource URL to edit. Setting it (re)renders the bound form. */
    src: string | undefined;
    /** The session-bound authenticated fetch (used for BOTH the read + the §10 write). */
    fetch: typeof fetch | undefined;
    /** The credential-free fetch for a public/foreign DATA read (rare for an editor). */
    publicFetch: typeof fetch | undefined;
    /**
     * The base URL writes are confined to (the DataWriter scope guard). Defaults to
     * the resource's own directory when unset, so a save can never leave the edited
     * resource's container.
     */
    base: string | undefined;
    /** Resolver options forwarded to the §9 pre-fetch (max bytes / timeout / test stub). */
    resolveOptions: ResolveOptions | undefined;
    protected saveStatus: SaveStatus;
    static properties: {
        src: {};
        fetch: {
            attribute: boolean;
        };
        publicFetch: {
            attribute: boolean;
        };
        base: {};
        resolveOptions: {
            attribute: boolean;
        };
        saveStatus: {
            state: boolean;
        };
    };
    constructor();
    /** Light DOM so a consuming app can `::part`/style the inner editable form. */
    protected createRenderRoot(): HTMLElement | DocumentFragment;
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
    protected abstract applyFormDeltaToExisting(formGraph: Store, existing: Store, resourceUrl: string): void | Promise<void>;
    /**
     * The §10 merge-save callback handed to <jeswr-shacl-form>. Builds a DataWriter
     * scoped to `base` (or the resource directory) and runs `saveMerged`, whose mutator
     * delegates to the subclass's {@link applyFormDeltaToExisting} on the LOADED graph.
     */
    protected mergeSaveCallback(): MergeSaveCallback;
    /** Build the data-graph source for the inner form: the resource, read with `fetch`. */
    protected dataSource(): GraphSource | undefined;
    /** Imperatively trigger a save on the inner editable form. */
    save(): Promise<boolean>;
    protected render(): TemplateResult;
}
/**
 * The default DataWriter scope base for a resource: its containing directory (the
 * path up to + including the last `/`). So a save of `…/tasks/1` is confined to
 * `…/tasks/`. Falls back to the resource origin on a parse failure (still
 * same-origin-confined). Pure; no network.
 */
export declare function defaultBaseFor(resourceUrl: string): string;
/** A minimal n3-Store read surface for the subject scan (avoids importing n3 here). */
interface QuadScanStore {
    getQuads(subject: unknown, predicate: unknown, object: unknown, graph: unknown): {
        subject: {
            termType: string;
            value: string;
        };
    }[];
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
export declare function findEditedSubject(formGraph: QuadScanStore, typeIri: string, conventional: string, namedNode: (value: string) => unknown): string;
export {};
