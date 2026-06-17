// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-feedback-button> — the suite's shared "report issue / give feedback /
// request help" control as a Web Component. A port of app-shell's React
// FeedbackButton (everything decoupled via attributes/props).
//
// TWO MECHANISMS (graceful degradation):
//   1. A `submit` function PROPERTY (the feedback proxy) — creates the issue
//      server-side so the reporter needs NO GitHub account; on success shows the
//      returned issue link.
//   2. ELSE (default, zero-infra) — open GitHub's prefilled new-issue page in a
//      new tab via `window.open(url, "_blank", "noopener,noreferrer")`.
//
// It ALSO emits a `feedback-submit` CustomEvent carrying the FeedbackPayload on
// every submit (so a host can observe/intercept regardless of mechanism).
//
// SECURITY:
//   - The issue URL is built by `buildIssueUrl`, which validates `repo` against
//     a strict owner/repo grammar (fail-closed) so the host can't be hijacked,
//     and URL-encodes title/body/labels.
//   - `window.open(..., "noopener,noreferrer")` so the opened tab cannot reach
//     back via `window.opener` (reverse-tabnabbing) — and we DISCARD the return
//     value (a non-null handle would be a back-channel; with noopener it's null
//     anyway, but we never expose it).
//   - PRIVACY: the WebID is attached ONLY when the consent box is ticked
//     (default OFF). Diagnostics never include tokens/secrets.
//
// The dialog is a focus-trapped, Escape-closable, `aria-modal` overlay.

import { css, html, LitElement, nothing } from "lit";
import {
  buildIssueUrl,
  composeIssueBody,
  composeIssueTitle,
  FEEDBACK_CATEGORIES,
  type FeedbackCategory,
  type FeedbackDiagnostics,
  type FeedbackPayload,
  type FeedbackSubmitResult,
  feedbackLabels,
} from "../feedback-core.js";
import { tokenStyles } from "../theme-tokens.js";

type Phase = "idle" | "submitting" | "success" | "error";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export class JeswrFeedbackButton extends LitElement {
  static properties = {
    // String props reflect (#122): @lit/react's createComponent forwards a
    // reflected string reliably under React 19; an un-reflected reactive prop
    // can be dropped (the React host's value never reaches the shadow render).
    repo: { type: String, reflect: true },
    appName: { type: String, attribute: "app-name", reflect: true },
    appVersion: { type: String, attribute: "app-version", reflect: true },
    webId: { type: String, attribute: "webid", reflect: true },
    label: { type: String, reflect: true },
    // function props (not attributes) — NOT reflected (object/function props):
    submit: { attribute: false },
    _open: { state: true },
    _category: { state: true },
    _description: { state: true },
    _includeWebId: { state: true },
    _phase: { state: true },
    _result: { state: true },
    _errorMessage: { state: true },
  };

  /** REQUIRED: the OWNER/REPO the issue is filed against (each app passes its OWN). */
  declare repo: string;
  /** This app's human name, attached to diagnostics + used in the dialog copy. */
  declare appName: string;
  /** Optional build SHA / version, attached to diagnostics. */
  declare appVersion: string | null;
  /** The signed-in user's WebID. Attached ONLY if the consent box is ticked. */
  declare webId: string | null;
  /** Trigger label (default "Feedback"). */
  declare label: string;
  /** Optional proxy hook — create the issue server-side. */
  declare submit?: (payload: FeedbackPayload) => Promise<FeedbackSubmitResult>;

  private declare _open: boolean;
  private declare _category: FeedbackCategory;
  private declare _description: string;
  private declare _includeWebId: boolean;
  private declare _phase: Phase;
  private declare _result: FeedbackSubmitResult | null;
  private declare _errorMessage: string | null;

  private previouslyFocused: HTMLElement | null = null;

  static styles = [
    tokenStyles,
    css`
      :host {
        display: inline-block;
      }
      .trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        height: 2.25rem;
        padding: 0 0.625rem;
        border: 1px solid transparent;
        border-radius: var(--jeswr-radius);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .trigger:hover {
        background: var(--jeswr-accent);
        color: var(--jeswr-accent-fg);
      }
      .trigger:focus-visible,
      :focus-visible {
        outline: 2px solid var(--jeswr-ring);
        outline-offset: 2px;
      }
      .icon {
        width: 1rem;
        height: 1rem;
      }
      .overlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      }
      .backdrop {
        position: absolute;
        inset: 0;
        border: 0;
        padding: 0;
        background: rgb(0 0 0 / 50%);
        cursor: default;
      }
      .dialog {
        position: relative;
        width: 100%;
        max-width: 28rem;
        padding: 1.25rem;
        border: 1px solid var(--jeswr-border);
        border-radius: var(--jeswr-radius);
        background: var(--jeswr-popover);
        color: var(--jeswr-popover-fg);
        box-shadow: 0 8px 32px rgb(0 0 0 / 24%);
        outline: none;
      }
      h2 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-top: 0.75rem;
      }
      fieldset {
        border: 0;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      legend {
        font-size: 0.875rem;
        font-weight: 500;
        padding: 0;
        margin-bottom: 0.25rem;
      }
      .cats {
        display: flex;
        gap: 0.5rem;
      }
      .cat {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
        padding: 0.5rem;
        border: 1px solid var(--jeswr-border);
        border-radius: calc(var(--jeswr-radius) - 0.25rem);
        font-size: 0.8125rem;
        cursor: pointer;
      }
      .cat:hover {
        background: var(--jeswr-accent);
        color: var(--jeswr-accent-fg);
      }
      .cat.selected {
        border-color: var(--jeswr-ring);
        background: var(--jeswr-accent);
        color: var(--jeswr-accent-fg);
      }
      .cat:focus-within {
        outline: 2px solid var(--jeswr-ring);
        outline-offset: 2px;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
      }
      label.field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        font-size: 0.875rem;
        font-weight: 500;
      }
      textarea {
        resize: vertical;
        min-height: 5rem;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--jeswr-border);
        border-radius: calc(var(--jeswr-radius) - 0.25rem);
        background: var(--jeswr-bg);
        color: var(--jeswr-fg);
        font: inherit;
        font-size: 0.875rem;
      }
      textarea:focus-visible {
        outline: 2px solid var(--jeswr-ring);
        outline-offset: 0;
      }
      .consent {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        font-size: 0.875rem;
        font-weight: 400;
      }
      .diag {
        font-size: 0.75rem;
        color: var(--jeswr-muted-fg);
        margin: 0;
      }
      .err {
        color: var(--jeswr-destructive);
        font-size: 0.875rem;
        margin: 0;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
      .btn {
        height: 2.25rem;
        padding: 0 0.875rem;
        border: 1px solid var(--jeswr-border);
        border-radius: calc(var(--jeswr-radius) - 0.25rem);
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 0.875rem;
        cursor: pointer;
      }
      .btn.ghost {
        border-color: transparent;
      }
      .btn:hover:not(:disabled) {
        background: var(--jeswr-accent);
        color: var(--jeswr-accent-fg);
      }
      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .btn:focus-visible {
        outline: 2px solid var(--jeswr-ring);
        outline-offset: 2px;
      }
      a {
        color: var(--jeswr-primary);
        font-weight: 500;
      }
    `,
  ];

  constructor() {
    super();
    this.repo = "";
    this.appName = "";
    this.appVersion = null;
    this.webId = null;
    this.label = "Feedback";
    this._open = false;
    this._category = "bug";
    this._description = "";
    this._includeWebId = false;
    this._phase = "idle";
    this._result = null;
    this._errorMessage = null;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this.onKeyDown, true);
  }

  private openDialog = (): void => {
    this.previouslyFocused =
      (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null) ??
      null;
    // Reset to a clean slate each time the dialog opens.
    this._category = "bug";
    this._description = "";
    this._includeWebId = false;
    this._phase = "idle";
    this._result = null;
    this._errorMessage = null;
    this._open = true;
    document.addEventListener("keydown", this.onKeyDown, true);
  };

  private closeDialog = (): void => {
    if (!this._open) return;
    this._open = false;
    document.removeEventListener("keydown", this.onKeyDown, true);
    // Restore focus to whatever was focused before the dialog opened.
    this.previouslyFocused?.focus?.();
    this.previouslyFocused = null;
  };

  // After each render, when the dialog has just opened, focus the textarea.
  // `changed` keys include the private reactive state `_open`; the generic
  // `Map<PropertyKey, unknown>` typing accepts the private key (the strict
  // `PropertyValues<this>` would not expose it through `keyof this`).
  protected override updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("_open") && this._open) {
      const ta = this.renderRoot.querySelector<HTMLTextAreaElement>("textarea");
      ta?.focus();
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this._open) return;
    if (e.key === "Escape") {
      this.closeDialog();
      return;
    }
    if (e.key !== "Tab") return;
    const dialog = this.renderRoot.querySelector<HTMLElement>(".dialog");
    if (!dialog) return;
    const focusable = this.tabbable(dialog);
    if (focusable.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    // The active element is in THIS shadow root; read it from the root.
    const active = (this.renderRoot as ShadowRoot).activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !active || !dialog.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !active || !dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };

  /**
   * The tabbable elements within `root`, collapsing each radio group to the
   * single member that participates in tab order (the checked radio, or the
   * first if none is checked) — mirroring the browser's real tab sequence so
   * Shift+Tab wrapping is correct after a non-default category is selected.
   */
  private tabbable(root: HTMLElement): HTMLElement[] {
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const groupTabbable = new Map<string, HTMLElement>();
    for (const el of candidates) {
      if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
        const existing = groupTabbable.get(el.name);
        if (existing === undefined || el.checked) groupTabbable.set(el.name, el);
      }
    }
    return candidates.filter((el) => {
      if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
        return groupTabbable.get(el.name) === el;
      }
      return true;
    });
  }

  private buildPayload(): FeedbackPayload {
    const diagnostics: FeedbackDiagnostics = {
      appName: this.appName,
      appVersion: this.appVersion ?? undefined,
      pageUrl: typeof location !== "undefined" ? location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      // PRIVACY: only attach the WebID when the reporter consented.
      webId: this._includeWebId && this.webId ? this.webId : undefined,
    };
    const title = composeIssueTitle(this._category, this._description);
    const body = composeIssueBody(this._description, diagnostics);
    return {
      repo: this.repo,
      category: this._category,
      title,
      body,
      labels: feedbackLabels(this._category),
      description: this._description,
      diagnostics,
    };
  }

  private handleSubmit = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (!this._description.trim()) return;
    const payload = this.buildPayload();

    // Always emit the payload so a host can observe/intercept either mechanism.
    this.dispatchEvent(
      new CustomEvent<FeedbackPayload>("feedback-submit", {
        detail: payload,
        bubbles: true,
        composed: true,
      }),
    );

    if (this.submit) {
      // MECHANISM 1: the proxy hook creates the issue server-side.
      this._phase = "submitting";
      this._errorMessage = null;
      try {
        const res = await this.submit(payload);
        this._result = res;
        this._phase = "success";
      } catch (err) {
        this._errorMessage = err instanceof Error ? err.message : "Could not submit feedback.";
        this._phase = "error";
      }
      return;
    }

    // MECHANISM 2 (default, zero-infra): open GitHub's prefilled new-issue page.
    // buildIssueUrl validates `repo` and throws on a bad value — surface that as
    // an in-dialog error rather than opening a bogus tab.
    let url: string;
    try {
      url = buildIssueUrl({
        repo: payload.repo,
        title: payload.title,
        body: payload.body,
        labels: payload.labels,
      });
    } catch (err) {
      this._errorMessage = err instanceof Error ? err.message : "Could not build the issue link.";
      this._phase = "error";
      return;
    }
    if (typeof window !== "undefined") {
      // noopener,noreferrer prevents reverse-tabnabbing; discard the handle so
      // there is no window.opener back-channel exposed.
      window.open(url, "_blank", "noopener,noreferrer");
    }
    this.closeDialog();
  };

  private renderDialog() {
    const versionLabel = this.appVersion ? ` ${this.appVersion}` : "";
    return html`
      <div part="overlay" class="overlay">
        <button
          part="backdrop"
          class="backdrop"
          type="button"
          tabindex="-1"
          aria-label="Close feedback dialog"
          @click=${this.closeDialog}
        ></button>
        <div
          part="dialog"
          class="dialog"
          role="dialog"
          aria-modal="true"
          aria-label=${`Feedback on ${this.appName || "this app"}`}
          tabindex="-1"
        >
          <h2 part="title">
            ${
              this._phase === "success"
                ? "Thanks for the feedback"
                : `Feedback on ${this.appName || "this app"}`
            }
          </h2>
          ${
            this._phase === "success" && this._result
              ? html`
                  <div style="margin-top:0.75rem; display:flex; flex-direction:column; gap:0.75rem; font-size:0.875rem;">
                    <p style="margin:0;">
                      Thanks — tracked as
                      <a href=${this._result.url} target="_blank" rel="noopener noreferrer"
                        >#${this._result.number}</a
                      >.
                    </p>
                    <div class="actions">
                      <button class="btn" type="button" @click=${this.closeDialog}>Close</button>
                    </div>
                  </div>
                `
              : html`
                  <form @submit=${this.handleSubmit}>
                    <fieldset>
                      <legend>What is this about?</legend>
                      <div class="cats">
                        ${FEEDBACK_CATEGORIES.map((c) => {
                          const selected = this._category === c.value;
                          return html`
                            <label class=${selected ? "cat selected" : "cat"}>
                              <input
                                class="sr-only"
                                type="radio"
                                name="jeswr-feedback-category"
                                .value=${c.value}
                                .checked=${selected}
                                @change=${() => {
                                  this._category = c.value;
                                }}
                              />
                              <span aria-hidden="true">${c.emoji}</span>
                              <span>${c.label}</span>
                            </label>
                          `;
                        })}
                      </div>
                    </fieldset>

                    <label class="field">
                      Tell us more
                      <textarea
                        required
                        rows="4"
                        placeholder="Describe the bug, idea, or question…"
                        .value=${this._description}
                        @input=${(ev: Event) => {
                          this._description = (ev.target as HTMLTextAreaElement).value;
                        }}
                      ></textarea>
                    </label>

                    ${
                      this.webId
                        ? html`
                            <label class="consent">
                              <input
                                type="checkbox"
                                .checked=${this._includeWebId}
                                @change=${(ev: Event) => {
                                  this._includeWebId = (ev.target as HTMLInputElement).checked;
                                }}
                              />
                              <span>Include my WebID so the maintainer can follow up</span>
                            </label>
                          `
                        : nothing
                    }

                    <p class="diag">
                      We attach basic diagnostics: app name + version (${
                        this.appName || "this app"
                      }${versionLabel}) and the current page URL.
                    </p>

                    ${
                      this._phase === "error" && this._errorMessage
                        ? html`<p class="err" role="alert">${this._errorMessage}</p>`
                        : nothing
                    }

                    <div class="actions">
                      <button
                        class="btn ghost"
                        type="button"
                        @click=${this.closeDialog}
                        ?disabled=${this._phase === "submitting"}
                      >
                        Cancel
                      </button>
                      <button
                        class="btn"
                        type="submit"
                        ?disabled=${!this._description.trim() || this._phase === "submitting"}
                      >
                        ${
                          this._phase === "submitting"
                            ? "Sending…"
                            : this.submit
                              ? "Send feedback"
                              : "Open issue on GitHub"
                        }
                      </button>
                    </div>
                  </form>
                `
          }
        </div>
      </div>
    `;
  }

  override render() {
    return html`
      <button
        part="trigger"
        class="trigger"
        type="button"
        aria-label=${this.label}
        @click=${this.openDialog}
      >
        <svg part="icon" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M12 7v4M12 14h.01" />
        </svg>
        <span part="label">${this.label}</span>
      </button>
      ${this._open ? this.renderDialog() : nothing}
    `;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("jeswr-feedback-button")) {
  customElements.define("jeswr-feedback-button", JeswrFeedbackButton);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-feedback-button": JeswrFeedbackButton;
  }
}
