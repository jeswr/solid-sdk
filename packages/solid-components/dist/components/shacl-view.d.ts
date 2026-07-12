import { LitElement, type PropertyValues } from "lit";
import { type GraphSource, type ResolveOptions } from "../shacl-view-fetch.js";
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
export declare class JeswrShaclView extends LitElement {
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
        status: {
            state: boolean;
        };
        errorMessage: {
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
    /** The data graph source to render against the shapes. Required to render. */
    values: GraphSource | undefined;
    /**
     * Optionally pin which node shape to render (shacl-form's `data-shape-subject`).
     * A plain string IRI — set on the inner element verbatim, NOT a URL to fetch.
     */
    shapeSubject: string | undefined;
    /** The session-bound authenticated fetch (for `trusted`+`auth` sources). */
    fetch: typeof fetch | undefined;
    /** The pristine credential-free fetch (for `trusted`+`public` sources). */
    publicFetch: typeof fetch | undefined;
    /**
     * Resolver options forwarded to the pre-fetch (max bytes / timeout / a test
     * loader stub for guarded-fetch). Never includes a fetch — those come from the
     * seam properties above so the credential boundary stays explicit.
     */
    resolveOptions: ResolveOptions | undefined;
    private status;
    private errorMessage;
    private shapesTurtle;
    private valuesTurtle;
    constructor();
    /** Render into the light DOM so a consuming app can `::part`/style the inner form. */
    protected createRenderRoot(): HTMLElement | DocumentFragment;
    willUpdate(changed: PropertyValues<this>): void;
    protected render(): import("lit-html").TemplateResult<1>;
    /**
     * Defence-in-depth: after every render, REMOVE any `*-url` dataset key from the
     * inner <shacl-form> that might somehow have appeared, and any key not on the
     * allow-list. This is belt-and-braces over the template (which already only
     * binds inline keys) so a future template edit cannot silently re-introduce a
     * URL fetch surface.
     */
    protected updated(_changed: PropertyValues<this>): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-shacl-view": JeswrShaclView;
    }
}
