import { LitElement } from "lit";
import { type FeedbackPayload, type FeedbackSubmitResult } from "../feedback-core.js";
export declare class JeswrFeedbackButton extends LitElement {
    static properties: {
        repo: {
            type: StringConstructor;
        };
        appName: {
            type: StringConstructor;
            attribute: string;
        };
        appVersion: {
            type: StringConstructor;
            attribute: string;
        };
        webId: {
            type: StringConstructor;
            attribute: string;
        };
        label: {
            type: StringConstructor;
        };
        submit: {
            attribute: boolean;
        };
        _open: {
            state: boolean;
        };
        _category: {
            state: boolean;
        };
        _description: {
            state: boolean;
        };
        _includeWebId: {
            state: boolean;
        };
        _phase: {
            state: boolean;
        };
        _result: {
            state: boolean;
        };
        _errorMessage: {
            state: boolean;
        };
    };
    /** REQUIRED: the OWNER/REPO the issue is filed against (each app passes its OWN). */
    repo: string;
    /** This app's human name, attached to diagnostics + used in the dialog copy. */
    appName: string;
    /** Optional build SHA / version, attached to diagnostics. */
    appVersion: string | null;
    /** The signed-in user's WebID. Attached ONLY if the consent box is ticked. */
    webId: string | null;
    /** Trigger label (default "Feedback"). */
    label: string;
    /** Optional proxy hook — create the issue server-side. */
    submit?: (payload: FeedbackPayload) => Promise<FeedbackSubmitResult>;
    private _open;
    private _category;
    private _description;
    private _includeWebId;
    private _phase;
    private _result;
    private _errorMessage;
    private previouslyFocused;
    static styles: import("lit").CSSResult[];
    constructor();
    disconnectedCallback(): void;
    private openDialog;
    private closeDialog;
    protected updated(changed: Map<PropertyKey, unknown>): void;
    private onKeyDown;
    /**
     * The tabbable elements within `root`, collapsing each radio group to the
     * single member that participates in tab order (the checked radio, or the
     * first if none is checked) — mirroring the browser's real tab sequence so
     * Shift+Tab wrapping is correct after a non-default category is selected.
     */
    private tabbable;
    private buildPayload;
    private handleSubmit;
    private renderDialog;
    render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-feedback-button": JeswrFeedbackButton;
    }
}
