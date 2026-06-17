// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-empty-state> — a centred "nothing here yet" placeholder with named
// slots for an icon, a title (or the `title` attribute*), a description, and an
// action (e.g. a button). Presentation-only; the host supplies the content.
//
// (*) Reactive prop is named `heading` and reflected to the `heading` attribute;
// `title` is a global HTML attribute that browsers turn into a tooltip, so we do
// NOT reuse it for the visible heading — use `heading` or the `title` SLOT.

import { css, html, LitElement, nothing } from "lit";
import { tokenStyles } from "../theme-tokens.js";

export class JeswrEmptyState extends LitElement {
  static properties = {
    // String props reflect (#122): @lit/react's createComponent forwards a
    // reflected string reliably under React 19; an un-reflected reactive prop
    // can be dropped, rendering the fallback instead of the host's text.
    heading: { type: String, reflect: true },
    description: { type: String, reflect: true },
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
      .icon {
        color: var(--jeswr-muted-fg);
      }
      ::slotted([slot="icon"]) {
        color: var(--jeswr-muted-fg);
      }
      .title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
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
      <div part="wrap" class="wrap">
        <slot name="icon" class="icon"></slot>
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

if (typeof customElements !== "undefined" && !customElements.get("jeswr-empty-state")) {
  customElements.define("jeswr-empty-state", JeswrEmptyState);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-empty-state": JeswrEmptyState;
  }
}
