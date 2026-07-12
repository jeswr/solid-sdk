import { LitElement, type TemplateResult } from "lit";
import type { LoginController } from "../login-controller.js";
/** The `session-change` CustomEvent detail. */
export interface SessionChangeDetail {
    webId: string | null;
    loggedIn: boolean;
}
/** The `login` CustomEvent detail. */
export interface LoginDetail {
    webId: string;
}
/**
 * The suite's keystone login surface as a framework-agnostic Web Component. Wraps
 * the reactive-auth DPoP login flow + silent session restore behind the injected
 * LoginController seam. Presentation/auth chrome — no RDF data model (the WebID is
 * an identity, surfaced via the `.webId` accessor + the `session-change` event).
 *
 * @summary Solid WebID login panel with silent session restore.
 * @slot - Content shown in the signed-in state (e.g. account links).
 * @csspart panel - The panel container.
 * @csspart heading - The "Sign in" / "Signed in" heading.
 * @csspart restoring - The "Restoring your session…" status row.
 * @csspart accounts - The recent-accounts list container.
 * @csspart account - A recent-account button.
 * @csspart avatar - A recent-account / signed-in avatar.
 * @csspart add-account - The "Use a different WebID" link button.
 * @csspart form - The WebID-entry form.
 * @csspart webid-input - The WebID URL input.
 * @csspart login-button - The "Sign in" submit button.
 * @csspart signed-in - The signed-in summary container.
 * @csspart webid - The displayed WebID line.
 * @csspart logout-button - The "Sign out" button.
 * @csspart error - The error message line.
 * @csspart not-configured - The "auth not configured" notice (no controller).
 * @fires session-change - Session changed; `detail: { webId: string | null, loggedIn: boolean }`.
 * @fires login - Interactive login succeeded; `detail: { webId: string }`.
 * @fires logout - The user signed out (no detail).
 * @cssprop [--jeswr-accent] - Hover background.
 * @cssprop [--jeswr-accent-fg] - Hover foreground.
 * @cssprop [--jeswr-bg] - Input background.
 * @cssprop [--jeswr-border] - Panel + field borders.
 * @cssprop [--jeswr-destructive] - Error-message colour.
 * @cssprop [--jeswr-fg] - Input text colour.
 * @cssprop [--jeswr-muted-fg] - Secondary text colour.
 * @cssprop [--jeswr-popover] - Panel background.
 * @cssprop [--jeswr-popover-fg] - Panel foreground.
 * @cssprop [--jeswr-primary] - Primary button background + link colour.
 * @cssprop [--jeswr-primary-fg] - Primary button foreground.
 * @cssprop [--jeswr-radius] - Corner radius.
 * @cssprop [--jeswr-ring] - Focus-ring colour.
 */
export declare class JeswrLoginPanel extends LitElement {
    #private;
    static properties: {
        controller: {
            attribute: boolean;
        };
        initialWebId: {
            type: StringConstructor;
            attribute: string;
        };
        autoRestore: {
            attribute: string;
            reflect: boolean;
            converter: {
                fromAttribute: (value: string | null) => boolean;
                toAttribute: (value: boolean) => string | null;
            };
        };
        heading: {
            type: StringConstructor;
        };
        _phase: {
            state: boolean;
        };
        _webIdInput: {
            state: boolean;
        };
        _error: {
            state: boolean;
        };
        _showInput: {
            state: boolean;
        };
    };
    /** The injected LoginController (the auth seam). */
    controller?: LoginController;
    /** Optional pre-filled WebID for the input. */
    initialWebId: string;
    /** Attempt silent restore on connect (default true). */
    autoRestore: boolean;
    /** Optional heading copy (default "Sign in"). */
    heading: string;
    private _phase;
    private _webIdInput;
    private _error;
    private _showInput;
    /**
     * The AUTHENTICATED, session-bound fetch (after login). Before a session
     * exists — or with no controller — this is the pristine native fetch, so it is
     * always safe to call and never null. Use for the user's OWN origin(s).
     */
    get fetch(): typeof fetch;
    /**
     * The PRISTINE native fetch (the foreign-origin / public-read boundary). NEVER
     * carries the session and never upgrades on a 401, so a session token cannot
     * leak cross-origin. Prefers the controller's own pre-patch snapshot; falls
     * back to the element's construction-time snapshot.
     */
    get publicFetch(): typeof fetch;
    /** The authenticated WebID, or null when logged out / no controller. */
    get webId(): string | null;
    static styles: import("lit").CSSResult[];
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected willUpdate(changed: Map<PropertyKey, unknown>): void;
    private renderAccount;
    private renderPrompt;
    private renderAuthenticated;
    render(): TemplateResult<1>;
}
/** Avatar-fallback initials from a display name or a WebID. Exported for tests. */
export declare function initialsOf(value: string): string;
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-login-panel": JeswrLoginPanel;
    }
}
