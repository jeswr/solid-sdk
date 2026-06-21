import { LitElement } from "lit";
/**
 * The error sibling of `<jeswr-empty-state>`: same named slots, styled with the
 * destructive token and `role="alert"`. Presentation chrome — no RDF data model.
 *
 * @summary Error-state placeholder with `role="alert"`.
 * @slot icon - Override the default alert icon.
 * @slot title - The heading (alternative to the `heading` attribute).
 * @slot description - The description (alternative to the `description` attribute).
 * @slot action - An action, e.g. a "Retry" button.
 * @csspart wrap - The centred wrapper (carries `role="alert"`).
 * @csspart icon - The default alert icon (when no `icon` slot content is supplied).
 * @csspart title - The rendered heading (when set via the `heading` attribute).
 * @csspart description - The rendered description (when set via the attribute).
 * @csspart action - The action slot container.
 * @cssprop [--jeswr-destructive] - Icon + heading colour.
 * @cssprop [--jeswr-muted-fg] - Description colour.
 */
export declare class JeswrErrorState extends LitElement {
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
        "jeswr-error-state": JeswrErrorState;
    }
}
