import { LitElement, type PropertyValues } from "lit";
import type { Store } from "n3";
import { type GraphSource, type ResolveOptions } from "../shacl-view-fetch.js";
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
export declare class JeswrShaclForm extends LitElement {
    #private;
    static properties: {
        shapes: {
            attribute: boolean;
        };
        values: {
            attribute: boolean;
        };
        shapeSubject: {
            attribute: string;
        };
        fetch: {
            attribute: boolean;
        };
        publicFetch: {
            attribute: boolean;
        };
        resolveOptions: {
            attribute: boolean;
        };
        mergeSave: {
            attribute: boolean;
        };
        showSaveButton: {
            type: BooleanConstructor;
            attribute: string;
        };
        status: {
            state: boolean;
        };
        saveStatus: {
            state: boolean;
        };
        errorMessage: {
            state: boolean;
        };
        saveErrorMessage: {
            state: boolean;
        };
        validationWarning: {
            state: boolean;
        };
        shapesTurtle: {
            state: boolean;
        };
        valuesTurtle: {
            state: boolean;
        };
    };
    /** The SHACL shapes graph source. Required before anything renders. */
    shapes: GraphSource | undefined;
    /** The data graph source to edit against the shapes. Required to render. */
    values: GraphSource | undefined;
    /** Optionally pin which node shape to edit (shacl-form's `data-shape-subject`). */
    shapeSubject: string | undefined;
    /** The session-bound authenticated fetch (for `trusted`+`auth` sources). */
    fetch: typeof fetch | undefined;
    /** The pristine credential-free fetch (for `trusted`+`public` sources). */
    publicFetch: typeof fetch | undefined;
    /** Resolver options forwarded to the pre-fetch (max bytes / timeout / test stub). */
    resolveOptions: ResolveOptions | undefined;
    /**
     * The §10 merge-save callback. When set, {@link JeswrShaclForm.save} delegates to
     * it (the per-class forms wire it to a DataWriter merge). When UNSET, `save()`
     * throws — this base element refuses to do a naive write itself.
     */
    mergeSave: MergeSaveCallback | undefined;
    /** Whether to render the built-in save button (default true). */
    showSaveButton: boolean;
    private status;
    private saveStatus;
    private errorMessage;
    private saveErrorMessage;
    private validationWarning;
    private shapesTurtle;
    private valuesTurtle;
    constructor();
    /** Light DOM so a consuming app can `::part`/style the inner form. */
    protected createRenderRoot(): HTMLElement | DocumentFragment;
    willUpdate(changed: PropertyValues<this>): void;
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
    save(): Promise<boolean>;
    protected render(): import("lit-html").TemplateResult<1>;
    /**
     * Belt-and-braces (identical to the view): after every render, REMOVE any `*-url`
     * dataset key or any key off the allow-list from the inner <shacl-form>, so a
     * future template edit can never silently re-introduce a fetch-URL surface. ALSO
     * asserts data-view is never set here (the edit form must stay editable).
     */
    protected updated(_changed: PropertyValues<this>): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-shacl-form": JeswrShaclForm;
    }
}
