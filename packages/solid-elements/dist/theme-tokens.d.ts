/**
 * The shared `:host` token block. Each `--jeswr-*` resolves:
 *   1. a consumer override of `--jeswr-*` on the host, else
 *   2. the app-shell shadcn variable inherited from the page, else
 *   3. the app-shell LIGHT OKLCH literal (so it works with no host theme).
 *
 * Components reference these via `var(--jeswr-bg)` etc. in their own styles.
 */
export declare const tokenStyles: import("lit").CSSResult;
