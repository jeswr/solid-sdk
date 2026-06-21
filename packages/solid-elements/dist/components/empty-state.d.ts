import { LitElement } from "lit";
/**
 * A centred "nothing here yet" placeholder with named slots for an icon, title,
 * description, and an action. Presentation chrome — no RDF data model.
 *
 * @summary Empty-state placeholder.
 * @slot icon - An icon shown above the heading.
 * @slot title - The heading (alternative to the `heading` attribute).
 * @slot description - The description (alternative to the `description` attribute).
 * @slot action - An action, e.g. a button.
 * @csspart wrap - The centred wrapper.
 * @csspart title - The rendered heading (when set via the `heading` attribute).
 * @csspart description - The rendered description (when set via the attribute).
 * @csspart action - The action slot container.
 * @cssprop [--jeswr-muted-fg] - Icon + description colour.
 */
export declare class JeswrEmptyState extends LitElement {
    static properties: {
        heading: {
            type: StringConstructor;
            reflect: boolean;
        };
        description: {
            type: StringConstructor;
            reflect: boolean;
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
