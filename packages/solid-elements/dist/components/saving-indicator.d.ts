import { LitElement } from "lit";
export type SavingState = "idle" | "saving" | "saved" | "error";
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
