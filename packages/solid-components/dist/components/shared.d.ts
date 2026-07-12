import { LitElement, type PropertyValues, type TemplateResult } from "lit";
import type { Store } from "n3";
import { DataController } from "../data-controller.js";
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
export declare const BASE_INPUT_PROPS: readonly ["src", "fetch", "publicFetch", "publicRead"];
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
export declare abstract class AbstractReadElement extends LitElement {
    #private;
    /** The resource / container URL to read. Setting it (re)reads through the seam. */
    src: string | undefined;
    /** The session-bound authenticated fetch (the user's origin). */
    fetch: typeof fetch | undefined;
    /** The credential-free fetch for foreign/public reads (no fallback — see DataSeam). */
    publicFetch: typeof fetch | undefined;
    /** Read with the public (credential-free) fetch — for a foreign-origin `src`. */
    publicRead: boolean;
    /**
     * A pre-parsed n3 Store to render directly, bypassing the network. When set it
     * takes precedence over `src` for the NEXT render. (The codegen/test seam — render
     * a graph already in hand with no fetch.) NOTE: deliberately named `store`, NOT
     * `dataset`, because `HTMLElement.dataset` is a reserved DOM property (a
     * `DOMStringMap`); shadowing it with an n3 Store would break the element type.
     */
    store: Store | undefined;
    protected status: ReadStatus;
    protected errorMessage: string;
    /** The graph the current render is bound to (from `src` read or `dataset`). */
    protected graph: Store | undefined;
    /** The final (post-redirect) URL the graph was read from — the base for subjects. */
    protected baseUrl: string | undefined;
    static properties: {
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
    /** Render into the light DOM so a consuming app can `::part`/style the output. */
    protected createRenderRoot(): HTMLElement | DocumentFragment;
    /** The input prop names this element re-reads on. Override to extend the base set. */
    protected inputProps(): readonly string[];
    willUpdate(changed: PropertyValues<this>): void;
    /**
     * Read this element's resource through the controller and return the parsed graph
     * plus the base URL its subjects resolve against. A single-resource element calls
     * `controller.read`; a container element calls `controller.listContainer`.
     */
    protected abstract loadFrom(controller: DataController, src: string, publicRead: boolean): Promise<{
        graph: Store;
        baseUrl: string;
    }>;
    /** Render the parsed model once `status === "ready"` (the subject graph in `graph`). */
    protected abstract renderReady(graph: Store, baseUrl: string): TemplateResult;
    protected render(): TemplateResult;
}
/**
 * An http(s)-only href filter for any IRI bound to an `<a href>`. Pod data is
 * untrusted: a `javascript:` / `data:` value must NEVER reach an href. Returns the
 * IRI when it is a well-formed http(s) URL, else `undefined` (the caller renders the
 * value as escaped TEXT instead of a link). Mirrors the data models' http(s) filter.
 */
export declare function safeHref(value: string | undefined): string | undefined;
/**
 * A `mailto:` filter for an email href. The contact model already returns canonical
 * `mailto:` IRIs, but this is the belt-and-braces filter at the DOM boundary so a
 * malformed value renders as text, not a link.
 */
export declare function safeMailto(value: string | undefined): string | undefined;
/** A `tel:` filter for a phone href, same belt-and-braces rationale as {@link safeMailto}. */
export declare function safeTel(value: string | undefined): string | undefined;
/** Strip a leading `mailto:` / `tel:` scheme for display text (the raw address). */
export declare function stripScheme(value: string): string;
/** Format a Date for display, or empty string for undefined. Locale-default, date only. */
export declare function formatDate(date: Date | undefined): string;
