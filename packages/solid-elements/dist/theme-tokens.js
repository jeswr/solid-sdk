// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// THEMING TOKEN CONTRACT (shadow DOM).
//
// These components live in shadow DOM, so the host page's `.dark`-flipped
// shadcn variables (--background, --foreground, …) do NOT directly style the
// shadow tree's elements — BUT CSS custom properties INHERIT through the shadow
// boundary. So each component reads a `--jeswr-*` variable that DEFAULTS, via
// nested `var()`, to the host app-shell shadcn variable, and finally to a
// hardcoded OKLCH literal (the app-shell light value) so the components also
// look right with NO host theme at all.
//
//   color: var(--jeswr-fg, var(--foreground, oklch(0.21 0.022 235)));
//
// Light/dark "just works": app-shell's ThemeProvider toggles `.dark` on
// <html>, which flips `--foreground` etc. on :root; that inherited value
// reaches the shadow tree through `var(--foreground, …)`. A consumer can also
// override any `--jeswr-*` directly on the host element to retheme a single
// component without touching the app theme.
//
// This module is the single source of truth for the contract; every component
// imports `tokenStyles` so the defaults stay identical across the library.
import { css } from "lit";
/**
 * The shared `:host` token block. Each `--jeswr-*` resolves:
 *   1. a consumer override of `--jeswr-*` on the host, else
 *   2. the app-shell shadcn variable inherited from the page, else
 *   3. the app-shell LIGHT OKLCH literal (so it works with no host theme).
 *
 * Components reference these via `var(--jeswr-bg)` etc. in their own styles.
 */
export const tokenStyles = css `
  :host {
    --jeswr-bg: var(--background, oklch(0.992 0.003 210));
    --jeswr-fg: var(--foreground, oklch(0.21 0.022 235));
    --jeswr-border: var(--border, oklch(0.91 0.012 220));
    --jeswr-muted-fg: var(--muted-foreground, oklch(0.5 0.018 230));
    --jeswr-primary: var(--primary, oklch(0.52 0.094 205));
    --jeswr-primary-fg: var(--primary-foreground, oklch(0.99 0.005 200));
    --jeswr-popover: var(--popover, oklch(1 0 0));
    --jeswr-popover-fg: var(--popover-foreground, oklch(0.21 0.022 235));
    --jeswr-destructive: var(--destructive, oklch(0.55 0.2 27));
    --jeswr-accent: var(--accent, oklch(0.94 0.03 195));
    --jeswr-accent-fg: var(--accent-foreground, oklch(0.31 0.05 215));
    --jeswr-ring: var(--ring, oklch(0.52 0.094 205));
    --jeswr-radius: var(--radius, 0.7rem);

    box-sizing: border-box;
    color: var(--jeswr-fg);
    font-family:
      ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
`;
