// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-account-menu> — the top-right account control: avatar + display name,
// opening a dropdown with the WebID and a Sign out action.
//
// DECOUPLED BY DESIGN (ports app-shell's React AccountMenu): everything is a
// prop/attribute — `webid`, `name`, `avatar-url` — and a `<slot>` lets the host
// inject extra menu items above Sign out. The avatar shows the image, or the
// `initials(name)` fallback. Emits a `sign-out` CustomEvent on the sign-out
// action; the host wires its own session teardown to that.

import { css, html, LitElement, nothing } from "lit";
import { tokenStyles } from "../theme-tokens.js";

/** Initials from a display name, for the avatar fallback. Exported for tests. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export class JeswrAccountMenu extends LitElement {
  static properties = {
    webId: { type: String, attribute: "webid" },
    name: { type: String },
    avatarUrl: { type: String, attribute: "avatar-url" },
    _open: { state: true },
  };

  /** The authenticated user's WebID (shown under the name; the canonical id). */
  declare webId: string | null;
  /** Human display name (foaf:name). Falls back to the WebID, then "Account". */
  declare name: string | null;
  /** Avatar image URL (foaf:img / vcard:hasPhoto). Falls back to initials. */
  declare avatarUrl: string | null;
  private declare _open: boolean;

  private readonly onDocPointer = (e: Event): void => {
    // Close when a click/tap lands outside this element, and remove this
    // document-level listener immediately so it does not leak while closed
    // (it is re-added by `toggle` the next time the menu opens).
    if (!e.composedPath().includes(this)) {
      this._open = false;
      document.removeEventListener("pointerdown", this.onDocPointer, true);
    }
  };

  static styles = [
    tokenStyles,
    css`
      :host {
        display: inline-block;
        position: relative;
      }
      .trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        height: auto;
        padding: 0.375rem 0.5rem;
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
      .trigger:focus-visible {
        outline: 2px solid var(--jeswr-ring);
        outline-offset: 2px;
      }
      .avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 9999px;
        background: var(--jeswr-accent);
        color: var(--jeswr-accent-fg);
        font-size: 0.75rem;
        font-weight: 600;
        overflow: hidden;
        flex: none;
      }
      .avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .trigger-name {
        max-width: 8rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.875rem;
        font-weight: 500;
      }
      .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 0.25rem);
        min-width: 16rem;
        max-width: 20rem;
        padding: 0.375rem;
        border: 1px solid var(--jeswr-border);
        border-radius: var(--jeswr-radius);
        background: var(--jeswr-popover);
        color: var(--jeswr-popover-fg);
        box-shadow: 0 4px 16px rgb(0 0 0 / 12%);
        z-index: 50;
      }
      .identity {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        padding: 0.375rem 0.5rem;
      }
      .identity-name {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .identity-webid {
        font-size: 0.75rem;
        color: var(--jeswr-muted-fg);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sep {
        height: 1px;
        margin: 0.375rem 0;
        background: var(--jeswr-border);
        border: 0;
      }
      .item {
        display: flex;
        width: 100%;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        border: 0;
        border-radius: calc(var(--jeswr-radius) - 0.25rem);
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .item:hover {
        background: var(--jeswr-accent);
        color: var(--jeswr-accent-fg);
      }
      .item:focus-visible {
        outline: 2px solid var(--jeswr-ring);
        outline-offset: -2px;
      }
      .icon {
        width: 1rem;
        height: 1rem;
        flex: none;
      }
    `,
  ];

  constructor() {
    super();
    this.webId = null;
    this.name = null;
    this.avatarUrl = null;
    this._open = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this.onDocPointer, true);
  }

  private toggle = (): void => {
    this._open = !this._open;
    if (this._open) {
      document.addEventListener("pointerdown", this.onDocPointer, true);
    } else {
      document.removeEventListener("pointerdown", this.onDocPointer, true);
    }
  };

  private signOut = (): void => {
    this._open = false;
    document.removeEventListener("pointerdown", this.onDocPointer, true);
    this.dispatchEvent(new CustomEvent("sign-out", { bubbles: true, composed: true }));
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this._open) {
      this._open = false;
      document.removeEventListener("pointerdown", this.onDocPointer, true);
    }
  };

  override render() {
    const displayName = this.name || this.webId || "Account";
    const hasIdentity = Boolean(this.name || this.webId);
    return html`
      <button
        part="trigger"
        class="trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded=${this._open ? "true" : "false"}
        aria-label="Account menu"
        @click=${this.toggle}
        @keydown=${this.onKeyDown}
      >
        <span part="avatar" class="avatar" aria-hidden="true">
          ${
            this.avatarUrl
              ? html`<img src=${this.avatarUrl} alt="" />`
              : hasIdentity
                ? initials(displayName)
                : "?"
          }
        </span>
        <span part="trigger-name" class="trigger-name">${this.name || "Signed in"}</span>
      </button>
      ${
        this._open
          ? html`
              <div part="menu" class="menu" role="menu" @keydown=${this.onKeyDown}>
                <div part="identity" class="identity">
                  <span class="identity-name">${displayName}</span>
                  ${
                    this.webId
                      ? html`<span part="webid" class="identity-webid">${this.webId}</span>`
                      : nothing
                  }
                </div>
                <hr class="sep" />
                <slot></slot>
                <button part="sign-out" class="item" type="button" role="menuitem" @click=${this.signOut}>
                  <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                  Sign out
                </button>
              </div>
            `
          : nothing
      }
    `;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("jeswr-account-menu")) {
  customElements.define("jeswr-account-menu", JeswrAccountMenu);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-account-menu": JeswrAccountMenu;
  }
}
