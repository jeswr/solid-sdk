import { LitElement } from "lit";
export declare class JeswrEmptyState extends LitElement {
    static properties: {
        heading: {
            type: StringConstructor;
            reflect: boolean;
        };
        description: {
            type: StringConstructor;
        };
    };
    /** Optional heading text (alternative to the `title` slot). */
    heading: string | null;
    /** Optional description text (alternative to the `description` slot). */
    description: string | null;
    static styles: import("lit").CSSResult[];
    constructor();
    render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-empty-state": JeswrEmptyState;
    }
}
