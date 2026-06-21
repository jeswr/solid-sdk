import { LitElement } from "lit";
import { type FeedbackPayload, type FeedbackSubmitResult } from "../feedback-core.js";
/**
 * The suite's shared "report issue / give feedback / request help" control. Either
 * files the issue via an injected `submit` proxy (no GitHub account needed) or
 * opens GitHub's prefilled new-issue page. Presentation chrome — no RDF data model.
 *
 * @summary Feedback dialog that files a GitHub issue.
 * @csspart trigger - The button that opens the feedback dialog.
 * @csspart icon - The trigger's chat-bubble icon.
 * @csspart label - The trigger's text label.
 * @csspart overlay - The full-screen modal overlay.
 * @csspart backdrop - The dimmed, click-to-close backdrop.
 * @csspart dialog - The dialog surface.
 * @csspart title - The dialog heading.
 * @fires feedback-submit - Submitted; `detail` is the FeedbackPayload (fires for both mechanisms).
 * @cssprop [--jeswr-accent] - Hover background.
 * @cssprop [--jeswr-accent-fg] - Hover foreground.
 * @cssprop [--jeswr-bg] - Textarea background.
 * @cssprop [--jeswr-border] - Field + card borders.
 * @cssprop [--jeswr-destructive] - Error-message colour.
 * @cssprop [--jeswr-fg] - Textarea text colour.
 * @cssprop [--jeswr-muted-fg] - Diagnostics note colour.
 * @cssprop [--jeswr-popover] - Dialog background.
 * @cssprop [--jeswr-popover-fg] - Dialog foreground.
 * @cssprop [--jeswr-primary] - Issue-link colour.
 * @cssprop [--jeswr-radius] - Corner radius.
 * @cssprop [--jeswr-ring] - Focus-ring + selected-category colour.
 */
export declare class JeswrFeedbackButton extends LitElement {
    static properties: {
        repo: {
            type: StringConstructor;
            reflect: boolean;
        };
        appName: {
            type: StringConstructor;
            attribute: string;
            reflect: boolean;
        };
        appVersion: {
            type: StringConstructor;
            attribute: string;
            reflect: boolean;
        };
        webId: {
            type: StringConstructor;
            attribute: string;
            reflect: boolean;
        };
        label: {
            type: StringConstructor;
            reflect: boolean;
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
    /** The success body (shown once the proxy `submit` resolved): the issue link + Close. */
    private renderSuccessBody;
    /** The category radio group (one selectable card per FEEDBACK_CATEGORY). */
    private renderCategoryChooser;
    /** The feedback form (category + description + optional consent + actions). */
    private renderForm;
    private renderDialog;
    render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-feedback-button": JeswrFeedbackButton;
    }
}
