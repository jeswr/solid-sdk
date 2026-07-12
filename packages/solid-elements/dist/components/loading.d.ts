import { LitElement } from "lit";
/**
 * A spinner with an optional label, announced via `role="status"` and respecting
 * `prefers-reduced-motion`. Presentation chrome — no RDF data model.
 *
 * @summary Loading spinner with optional label.
 * @csspart status - The `role="status"` wrapper.
 * @csspart spinner - The animated spinner.
 * @csspart label - The optional label text.
 * @cssprop [--jeswr-border] - Spinner track colour.
 * @cssprop [--jeswr-primary] - Spinner active-arc colour.
 * @cssprop [--jeswr-muted-fg] - Label colour.
 */
export declare class JeswrLoading extends LitElement {
    static properties: {
        label: {
            type: StringConstructor;
            reflect: boolean;
        };
    };
    /** Optional text shown next to the spinner (also the accessible name). */
    label: string | null;
    static styles: import("lit").CSSResult[];
    constructor();
    render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-loading": JeswrLoading;
    }
}
