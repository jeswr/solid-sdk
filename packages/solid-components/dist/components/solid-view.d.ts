import { LitElement, type PropertyValues, type TemplateResult } from "lit";
import { type ComponentMode } from "../resolver.js";
export declare class SolidView extends LitElement {
    #private;
    /** The resource URL to render. Setting it re-resolves. */
    src: string | undefined;
    /**
     * Optionally PIN the RDF class to render as, skipping the type probe entirely (the
     * codegen "I know it's a wf:Task" path). A plain class IRI string. When set, the
     * resolver maps it directly and no network probe is done before mount.
     */
    classIri: string | undefined;
    /** Constrain resolution to a mode (Phase-1 is always `view`). */
    mode: ComponentMode;
    /** The session-bound authenticated fetch. */
    fetch: typeof fetch | undefined;
    /** The credential-free fetch for foreign/public reads (no fallback — see DataSeam). */
    publicFetch: typeof fetch | undefined;
    /** Probe + read with the public (credential-free) fetch — for a foreign-origin `src`. */
    publicRead: boolean;
    private status;
    private errorMessage;
    private resolved;
    static properties: {
        src: {};
        classIri: {
            attribute: string;
        };
        mode: {};
        fetch: {
            attribute: boolean;
        };
        publicFetch: {
            attribute: boolean;
        };
        publicRead: {
            type: BooleanConstructor;
            attribute: string;
        };
        status: {
            state: boolean;
        };
        errorMessage: {
            state: boolean;
        };
        resolved: {
            state: boolean;
        };
    };
    constructor();
    /** Light DOM so the consuming app can `::part`/style the mounted child. */
    protected createRenderRoot(): HTMLElement | DocumentFragment;
    willUpdate(changed: PropertyValues<this>): void;
    protected render(): TemplateResult;
    /**
     * After render, (re)mount the resolved child with the seam + src wired as
     * properties. Done in `updated` (not the template) so the OBJECT props (`fetch`,
     * `publicFetch`) are set on the element instance, which a string attribute can't do.
     */
    protected updated(_changed: PropertyValues<this>): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "solid-view": SolidView;
    }
}
