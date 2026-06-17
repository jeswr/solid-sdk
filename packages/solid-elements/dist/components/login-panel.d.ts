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
