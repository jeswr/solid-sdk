import { LitElement } from "lit";
export type SavingState = "idle" | "saving" | "saved" | "error";
/**
 * The small, non-intrusive "Saving… / Saved / Error" cue for the suite's
 * optimistic-mutation UX. A `state` attribute selects the rendering. Respects
 * `prefers-reduced-motion`. Presentation chrome — no RDF data model.
 *
 * @summary Saving/saved/error status indicator.
 * @csspart status - The `role="status"` wrapper.
 * @csspart spinner - The spinner shown in the "saving" state.
 * @csspart glyph - The check/alert glyph (saved/error states).
 * @csspart label - The status text.
 * @cssprop [--jeswr-border] - Spinner track colour.
 * @cssprop [--jeswr-primary] - Spinner active-arc colour.
 * @cssprop [--jeswr-muted-fg] - Default text colour.
 * @cssprop [--jeswr-destructive] - Error-state colour.
 */
export declare class JeswrSavingIndicator extends LitElement {
    static properties: {
        state: {
            type: StringConstructor;
            reflect: boolean;
        };
        savingLabel: {
            type: StringConstructor;
            attribute: string;
            reflect: boolean;
        };
        savedLabel: {
            type: StringConstructor;
            attribute: string;
            reflect: boolean;
        };
        errorLabel: {
            type: StringConstructor;
            attribute: string;
            reflect: boolean;
        };
    };
    /** The current mutation state. Reflected to the `state` attribute. */
    state: SavingState;
    savingLabel: string;
    savedLabel: string;
    errorLabel: string;
    static styles: import("lit").CSSResult[];
    constructor();
    private get safeState();
    render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-saving-indicator": JeswrSavingIndicator;
    }
}
