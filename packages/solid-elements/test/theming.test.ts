// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Theming-contract tests.
//
// LIMITATION (documented): neither happy-dom nor jsdom resolves `var(--x)`
// through a shadow-root boundary via getComputedStyle (no real CSS cascade
// engine). So we cannot assert the *computed* colour. Instead we assert the
// CONTRACT directly: the shared `tokenStyles` block defines each `--jeswr-*`
// with the documented `var(--jeswr-x, var(--app-shell-var, <oklch literal>))`
// fallback chain, and every component includes `tokenStyles` in its styles. In
// a real browser those custom properties inherit through the shadow boundary, so
// app-shell's `.dark`-flipped `--background` etc. reach the shadow tree.
import { describe, expect, it } from "vitest";
import { JeswrAccountMenu } from "../src/components/account-menu.js";
import { JeswrEmptyState } from "../src/components/empty-state.js";
import { JeswrErrorState } from "../src/components/error-state.js";
import { JeswrFeedbackButton } from "../src/components/feedback-button.js";
import { JeswrLoading } from "../src/components/loading.js";
import { JeswrSavingIndicator } from "../src/components/saving-indicator.js";
import { JeswrThemeToggle } from "../src/components/theme-toggle.js";
import { tokenStyles } from "../src/theme-tokens.js";

function cssOf(styles: unknown): string {
  const arr = Array.isArray(styles) ? styles : [styles];
  return arr.map((s) => (s as { cssText?: string }).cssText ?? "").join("\n");
}

// Each row: the jeswr token, the app-shell var it defaults to, and the literal
// fallback's kind (every colour is an `oklch(...)`; the radius is a `rem`).
const TOKEN_CONTRACT: ReadonlyArray<[token: string, appShellVar: string, literalKind: string]> = [
  ["--jeswr-bg", "--background", "oklch"],
  ["--jeswr-fg", "--foreground", "oklch"],
  ["--jeswr-border", "--border", "oklch"],
  ["--jeswr-muted-fg", "--muted-foreground", "oklch"],
  ["--jeswr-primary", "--primary", "oklch"],
  ["--jeswr-primary-fg", "--primary-foreground", "oklch"],
  ["--jeswr-popover", "--popover", "oklch"],
  ["--jeswr-popover-fg", "--popover-foreground", "oklch"],
  ["--jeswr-destructive", "--destructive", "oklch"],
  ["--jeswr-accent", "--accent", "oklch"],
  ["--jeswr-accent-fg", "--accent-foreground", "oklch"],
  ["--jeswr-ring", "--ring", "oklch"],
  ["--jeswr-radius", "--radius", "0.7rem"],
];

describe("token contract — tokenStyles defaults each --jeswr-* to the app-shell var", () => {
  const css = cssOf(tokenStyles);
  for (const [token, appShellVar, literalKind] of TOKEN_CONTRACT) {
    it(`${token} → var(${appShellVar}, <${literalKind}>)`, () => {
      // The contract is: `--jeswr-x: var(--app-shell-var, <literal>);`
      const re = new RegExp(
        `${token}:\\s*var\\(\\s*${appShellVar}\\s*,\\s*${literalKind.replace(/[.]/g, "\\.")}`,
      );
      expect(css).toMatch(re);
    });
  }
});

describe("every component includes the shared tokenStyles block", () => {
  const components = [
    ["jeswr-theme-toggle", JeswrThemeToggle],
    ["jeswr-account-menu", JeswrAccountMenu],
    ["jeswr-feedback-button", JeswrFeedbackButton],
    ["jeswr-empty-state", JeswrEmptyState],
    ["jeswr-error-state", JeswrErrorState],
    ["jeswr-loading", JeswrLoading],
    ["jeswr-saving-indicator", JeswrSavingIndicator],
  ] as const;
  for (const [tag, cls] of components) {
    it(`${tag} declares the --jeswr-* tokens`, () => {
      const css = cssOf(cls.styles);
      // tokenStyles defines --jeswr-fg (a representative member of the contract).
      expect(css).toContain("--jeswr-fg");
      // And the component actually consumes a --jeswr-* var somewhere.
      expect(css).toMatch(/var\(--jeswr-/);
    });
  }
});
