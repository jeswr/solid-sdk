import { LitElement } from "lit";
/** Initials from a display name, for the avatar fallback. Exported for tests. */
export declare function initials(name: string): string;
export declare class JeswrAccountMenu extends LitElement {
    static properties: {
        webId: {
            type: StringConstructor;
            attribute: string;
            reflect: boolean;
        };
        name: {
            type: StringConstructor;
            reflect: boolean;
        };
        avatarUrl: {
            type: StringConstructor;
            attribute: string;
            reflect: boolean;
        };
        _open: {
            state: boolean;
        };
    };
    /** The authenticated user's WebID (shown under the name; the canonical id). */
    webId: string | null;
    /** Human display name (foaf:name). Falls back to the WebID, then "Account". */
    name: string | null;
    /** Avatar image URL (foaf:img / vcard:hasPhoto). Falls back to initials. */
    avatarUrl: string | null;
    private _open;
    private readonly onDocPointer;
    static styles: import("lit").CSSResult[];
    constructor();
    disconnectedCallback(): void;
    private toggle;
    private signOut;
    private onKeyDown;
    render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-account-menu": JeswrAccountMenu;
    }
}
