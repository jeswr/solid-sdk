// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-theme-toggle> — a framework-agnostic light/dark/system switcher.
//
// Co-operative, NOT authoritative: it reads + writes the SAME "app-shell-theme"
// localStorage key and the SAME `.dark` class on <html> that @jeswr/app-shell's
// React ThemeProvider uses (see theme-core.ts), so a host ThemeProvider and
// this component converge on the same DOM state instead of fighting. Use this
// when you DON'T have a React ThemeProvider (a vanilla page, or a non-React
// island); when you DO, the toggle still works — both write the same key/class.
//
// On connect it reflects the stored/resolved state. Clicking cycles
// light → dark → system. In "system" mode it live-follows
// prefers-color-scheme. It emits a `theme-change` CustomEvent
// (detail: { theme, resolvedTheme }) and reflects a `theme` attribute so
// consumers can read state.
//
// NOTE ON `useDefineForClassFields: true` (the tsconfig choice): we declare
// reactive props via `static properties` and assign their defaults in the
// CONSTRUCTOR (not as class-field initializers). With class fields ON, a field
// initializer would emit a `[[Define]]` that SHADOWS the accessor Lit installs
// on the prototype for a reactive property (the well-known Lit footgun). The
// declarative `static properties` form + constructor assignment sidesteps it
// entirely — verified by the reactivity tests.

import { css, html, LitElement, type PropertyValues } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import {
  applyResolvedTheme,
  persistTheme,
  type ResolvedTheme,
  readStoredTheme,
  resolveTheme,
  type Theme,
} from "../theme-core.js";
import { tokenStyles } from "../theme-tokens.js";

const SUN = svgIcon(
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
);
const MOON = svgIcon('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>');
const MONITOR = svgIcon(
  '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
);

function svgIcon(inner: string): string {
  return `<svg part="icon" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

export class JeswrThemeToggle extends LitElement {
  static properties = {
    theme: { type: String, reflect: true },
    resolvedTheme: { type: String, attribute: "resolved-theme", reflect: true },
  };

  /** The user's selected preference. Reflected to the `theme` attribute. */
  declare theme: Theme;
  /** The concrete mode applied right now. Reflected to `resolved-theme`. */
  declare resolvedTheme: ResolvedTheme;

  private mql: MediaQueryList | null = null;
  private readonly onSystemChange = () => this.applyTheme(this.theme, false);

  static styles = [
    tokenStyles,
    css`
      :host {
        display: inline-block;
      }
      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
        height: 2.25rem;
        min-width: 2.25rem;
        padding: 0 0.5rem;
        border: 1px solid transparent;
        border-radius: var(--jeswr-radius);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      button:hover {
        background: var(--jeswr-accent);
        color: var(--jeswr-accent-fg);
      }
      button:focus-visible {
        outline: 2px solid var(--jeswr-ring);
        outline-offset: 2px;
      }
      .icon {
        width: 1.25rem;
        height: 1.25rem;
      }
      .label {
        font-size: 0.875rem;
        font-weight: 500;
      }
    `,
  ];

  constructor() {
    super();
    // Defaults assigned in the constructor (NOT class-field initializers) to
    // avoid shadowing Lit's reactive accessors under useDefineForClassFields.
    this.theme = "system";
    this.resolvedTheme = "light";
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Adopt any persisted preference; reflect the resolved state.
    const stored = readStoredTheme();
    this.applyTheme(stored ?? "system", false);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.teardownMediaListener();
  }

  /**
   * Set the preference, resolve + apply it to <html>, (un)subscribe to the OS
   * media query, and (when `persist`) save it. Emits `theme-change`.
   */
  private applyTheme(theme: Theme, persist: boolean): void {
    this.theme = theme;
    const resolved = resolveTheme(theme);
    this.resolvedTheme = resolved;
    applyResolvedTheme(resolved);
    if (persist) {
      // Persist via the shared helper so the key matches app-shell exactly.
      persistTheme(theme);
    }
    this.syncMediaListener(theme);
    this.dispatchEvent(
      new CustomEvent("theme-change", {
        detail: { theme, resolvedTheme: resolved },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Subscribe to prefers-color-scheme only while in "system" mode. */
  private syncMediaListener(theme: Theme): void {
    if (theme === "system" && typeof window !== "undefined" && window.matchMedia) {
      if (!this.mql) {
        this.mql = window.matchMedia("(prefers-color-scheme: dark)");
        this.mql.addEventListener("change", this.onSystemChange);
      }
    } else {
      this.teardownMediaListener();
    }
  }

  private teardownMediaListener(): void {
    if (this.mql) {
      this.mql.removeEventListener("change", this.onSystemChange);
      this.mql = null;
    }
  }

  private onClick = (): void => {
    // Cycle light → dark → system → light, persisting the user's choice.
    const order: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
    this.applyTheme(order[this.theme], true);
  };

  override render() {
    const icon = this.theme === "dark" ? MOON : this.theme === "light" ? SUN : MONITOR;
    const label = this.theme === "dark" ? "Dark" : this.theme === "light" ? "Light" : "System";
    return html`
      <button
        part="button"
        type="button"
        @click=${this.onClick}
        aria-label=${`Change colour theme (currently ${label})`}
        title=${`Theme: ${label}`}
      >
        ${unsafeIcon(icon)}
        <span part="label" class="label">${label}</span>
      </button>
    `;
  }

  // Keep the public attribute in sync if a consumer sets the property directly
  // (e.g. el.theme = "dark") without going through the click path.
  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("theme") && this.hasUpdated) {
      // Re-resolve + reapply when the property is set externally.
      const resolved = resolveTheme(this.theme);
      if (resolved !== this.resolvedTheme) {
        this.resolvedTheme = resolved;
        applyResolvedTheme(resolved);
      }
      this.syncMediaListener(this.theme);
    }
  }
}

// Lit's `unsafeHTML` is only needed to inline a static, code-controlled SVG
// string (never user input), so we use the directive narrowly here.
function unsafeIcon(svg: string) {
  return unsafeHTML(svg);
}

if (typeof customElements !== "undefined" && !customElements.get("jeswr-theme-toggle")) {
  customElements.define("jeswr-theme-toggle", JeswrThemeToggle);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-theme-toggle": JeswrThemeToggle;
  }
}
