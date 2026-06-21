import { LitElement } from "lit";
/**
 * Initials from a display name, for the avatar fallback. Exported for tests + as
 * part of the public API. Delegates to the shared internal `initialsFromName` (the
 * one reviewed implementation, also used by <jeswr-login-panel>'s `initialsOf`).
 */
export declare function initials(name: string): string;
/**
 * The top-right account control: avatar + display name, opening a dropdown with
 * the WebID and a Sign out action. Decoupled via attributes; presentation chrome.
 * No RDF data model (the host supplies `webid`/`name`/`avatar-url`).
 *
 * @summary Account avatar + dropdown with WebID and sign-out.
 * @slot - Extra menu items injected above "Sign out".
 * @csspart trigger - The avatar+name button that opens the menu.
 * @csspart avatar - The circular avatar (image or initials).
 * @csspart trigger-name - The name shown next to the avatar in the trigger.
 * @csspart menu - The dropdown menu container.
 * @csspart identity - The name+WebID block at the top of the menu.
 * @csspart webid - The WebID line in the identity block.
 * @csspart sign-out - The "Sign out" menu item button.
 * @fires sign-out - The user activated "Sign out" (no detail); host tears down the session.
 * @cssprop [--jeswr-accent] - Hover background.
 * @cssprop [--jeswr-accent-fg] - Hover/avatar foreground.
 * @cssprop [--jeswr-border] - Menu + separator border colour.
 * @cssprop [--jeswr-muted-fg] - WebID line colour.
 * @cssprop [--jeswr-popover] - Menu background.
 * @cssprop [--jeswr-popover-fg] - Menu foreground.
 * @cssprop [--jeswr-radius] - Corner radius.
 * @cssprop [--jeswr-ring] - Focus-ring colour.
 */
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
