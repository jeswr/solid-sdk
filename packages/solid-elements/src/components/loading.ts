// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-loading> — a spinner with an optional label. `label` shows next to the
// spinner; `aria-live="polite"` + a `role="status"` wrapper announces it.
// Respects `prefers-reduced-motion` (the spinner does not animate when the user
// asked to reduce motion). Presentation-only.

import { css, html, LitElement, nothing } from "lit";
import { tokenStyles } from "../theme-tokens.js";

export class JeswrLoading extends LitElement {
  static properties = {
    label: { type: String },
  };

  /** Optional text shown next to the spinner (also the accessible name). */
  declare label: string | null;

  static styles = [
    tokenStyles,
    css`
      :host {
        display: inline-flex;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--jeswr-muted-fg);
        font-size: 0.875rem;
      }
      .spinner {
        width: 1.125rem;
        height: 1.125rem;
        border: 2px solid var(--jeswr-border);
        border-top-color: var(--jeswr-primary);
        border-radius: 9999px;
        animation: jeswr-spin 0.7s linear infinite;
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
    this.label = null;
  }

  override render() {
    return html`
      <span
        part="status"
        class="status"
        role="status"
        aria-live="polite"
        aria-label=${this.label ?? "Loading"}
      >
        <span part="spinner" class="spinner" aria-hidden="true"></span>
        ${this.label ? html`<span part="label">${this.label}</span>` : nothing}
      </span>
    `;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("jeswr-loading")) {
  customElements.define("jeswr-loading", JeswrLoading);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-loading": JeswrLoading;
  }
}
