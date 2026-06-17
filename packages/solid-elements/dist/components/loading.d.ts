import { LitElement } from "lit";
export declare class JeswrLoading extends LitElement {
    static properties: {
        label: {
            type: StringConstructor;
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
