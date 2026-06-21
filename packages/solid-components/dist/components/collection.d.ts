import { type TemplateResult } from "lit";
import type { Store } from "n3";
import type { DataController } from "../data-controller.js";
import { AbstractReadElement } from "./shared.js";
/** A Solid Type Index registration (the seam a consumer injects). */
export interface TypeIndexEntry {
    /** The registered RDF class IRI (`solid:forClass`). */
    readonly class: string;
    /** The container that holds instances of that class (`solid:instanceContainer`). */
    readonly instanceContainer: string;
}
/**
 * A generic LDP container listing element.
 *
 * (No `@solid-class` for a NAMED model class: it binds the generic `ldp:Container` /
 * `ldp:BasicContainer` — declared in the resolver map as the lowest-priority fallback
 * — rather than a domain class. Advertised here so the CEM still records the binding.)
 *
 * @solid-class http://www.w3.org/ns/ldp#Container
 * @solid-mode view
 * @solid-cardinality container
 *
 * @csspart list    - The <ul> of children.
 * @csspart child   - One child <li>.
 * @csspart link    - A child's link.
 * @csspart type    - A child's container/type badge.
 * @csspart empty   - Placeholder when the container is empty.
 * @csspart error   - The error message when the read fails.
 * @csspart loading - Placeholder shown while reading.
 */
export declare class JeswrCollection extends AbstractReadElement {
    #private;
    /**
     * Optional injected Solid Type Index registrations, so a child container that is a
     * registered `solid:instanceContainer` is labelled by its class. Phase-1 does not
     * fetch the index itself (a documented follow-up); a consumer with the registrations
     * passes them here.
     */
    typeIndex: TypeIndexEntry[] | undefined;
    static get properties(): {
        typeIndex: {
            attribute: boolean;
        };
        src: {};
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
        store: {
            attribute: boolean;
        };
        status: {
            state: boolean;
        };
        errorMessage: {
            state: boolean;
        };
        graph: {
            state: boolean;
        };
        baseUrl: {
            state: boolean;
        };
    };
    constructor();
    protected inputProps(): readonly string[];
    protected loadFrom(controller: DataController, src: string, publicRead: boolean): Promise<{
        graph: Store;
        baseUrl: string;
    }>;
    protected renderReady(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-collection": JeswrCollection;
    }
}
