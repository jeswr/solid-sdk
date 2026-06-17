// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-saving-indicator> — the small, non-intrusive "Saving… / Saved / Error"
// cue for the suite's optimistic-mutation UX invariant. A `state` attribute in
// `idle | saving | saved | error` selects the rendering:
//   idle   → nothing
//   saving → a spinner + "Saving…"
//   saved  → a check + "Saved"
//   error  → an alert glyph + "Error" (destructive token)
// Respects `prefers-reduced-motion` for the spinner. Presentation-only.
import { css, html, LitElement } from "lit";
import { tokenStyles } from "../theme-tokens.js";
const STATES = new Set(["idle", "saving", "saved", "error"]);
export class JeswrSavingIndicator extends LitElement {
    static properties = {
        // String props reflect (#122): @lit/react's createComponent forwards a
        // reflected string reliably under React 19; an un-reflected reactive prop
        // can be dropped (the React host's custom label never reaches the render).
        state: { type: String, reflect: true },
        savingLabel: { type: String, attribute: "saving-label", reflect: true },
        savedLabel: { type: String, attribute: "saved-label", reflect: true },
        errorLabel: { type: String, attribute: "error-label", reflect: true },
    };
    static styles = [
        tokenStyles,
        css `
      :host {
        display: inline-flex;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.8125rem;
        color: var(--jeswr-muted-fg);
      }
      .status.error {
        color: var(--jeswr-destructive);
      }
      .spinner {
        width: 0.875rem;
        height: 0.875rem;
        border: 2px solid var(--jeswr-border);
        border-top-color: var(--jeswr-primary);
        border-radius: 9999px;
        animation: jeswr-spin 0.7s linear infinite;
      }
      .glyph {
        width: 0.875rem;
        height: 0.875rem;
      }
      @keyframes jeswr-spin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .spinner {
          animation: none;
        }
      }
    `,
    ];
    constructor() {
        super();
        this.state = "idle";
        this.savingLabel = "Saving…";
        this.savedLabel = "Saved";
        this.errorLabel = "Error";
    }
    get safeState() {
        return STATES.has(this.state) ? this.state : "idle";
    }
    render() {
        const state = this.safeState;
        if (state === "idle") {
            // Still announce politely (an empty live region) but render nothing visible.
            return html `<span part="status" role="status" aria-live="polite"></span>`;
        }
        if (state === "saving") {
            return html `
        <span part="status" class="status" role="status" aria-live="polite">
          <span part="spinner" class="spinner" aria-hidden="true"></span>
          <span part="label">${this.savingLabel}</span>
        </span>
      `;
        }
        if (state === "saved") {
            return html `
        <span part="status" class="status" role="status" aria-live="polite">
          <svg part="glyph" class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span part="label">${this.savedLabel}</span>
        </span>
      `;
        }
        // error
        return html `
      <span part="status" class="status error" role="status" aria-live="polite">
        <svg part="glyph" class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <span part="label">${this.errorLabel}</span>
      </span>
    `;
    }
}
if (typeof customElements !== "undefined" && !customElements.get("jeswr-saving-indicator")) {
    customElements.define("jeswr-saving-indicator", JeswrSavingIndicator);
}
