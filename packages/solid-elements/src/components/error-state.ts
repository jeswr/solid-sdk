// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-error-state> — the error sibling of <jeswr-empty-state>. Same named
// slots (icon / title / description / action) but styled with the destructive
// token and `role="alert"` so assistive tech announces it. Presentation-only.

import { css, html, LitElement, nothing } from "lit";
import { tokenStyles } from "../theme-tokens.js";

export class JeswrErrorState extends LitElement {
  static properties = {
    heading: { type: String, reflect: true },
    description: { type: String },
  };

  /** Optional heading text (alternative to the `title` slot). */
  declare heading: string | null;
  /** Optional description text (alternative to the `description` slot). */
  declare description: string | null;

  static styles = [
    tokenStyles,
    css`
      :host {
        display: flex;
      }
      .wrap {
        display: flex;
        flex: 1;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        padding: 2.5rem 1.5rem;
        text-align: center;
      }
      .default-icon,
      ::slotted([slot="icon"]) {
        color: var(--jeswr-destructive);
      }
      .default-icon {
        width: 2rem;
        height: 2rem;
      }
      .title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: var(--jeswr-destructive);
      }
      .desc {
        margin: 0;
        max-width: 30rem;
        font-size: 0.875rem;
        color: var(--jeswr-muted-fg);
      }
      .action {
        margin-top: 0.25rem;
      }
    `,
  ];

  constructor() {
    super();
    this.heading = null;
    this.description = null;
  }

  override render() {
    return html`
      <div part="wrap" class="wrap" role="alert">
        <slot name="icon">
          <svg part="icon" class="default-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        </slot>
        ${this.heading ? html`<p part="title" class="title">${this.heading}</p>` : nothing}
        <slot name="title"></slot>
        ${
          this.description
            ? html`<p part="description" class="desc">${this.description}</p>`
            : nothing
        }
        <slot name="description"></slot>
        <div part="action" class="action"><slot name="action"></slot></div>
      </div>
    `;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("jeswr-error-state")) {
  customElements.define("jeswr-error-state", JeswrErrorState);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-error-state": JeswrErrorState;
  }
}
