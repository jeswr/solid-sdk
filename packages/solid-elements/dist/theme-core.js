// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// theme-core — the framework-agnostic theme primitives shared by the
// <jeswr-theme-toggle> Web Component. These deliberately MIRROR
// @jeswr/app-shell's ThemeProvider contract EXACTLY so a host ThemeProvider and
// this component co-operate (both write the SAME storage key + `.dark` class):
//
//   - storage key: "app-shell-theme"
//   - values: "light" | "dark" | "system"
//   - resolved mode toggles the ".dark" class on document.documentElement
//   - sets document.documentElement.style.colorScheme to "dark" | "light"
//   - "system" follows prefers-color-scheme live
//
// The component does NOT own theme truth — it is idempotent and co-operative:
// it reads the current stored/resolved state and writes the SAME key/class the
// host ThemeProvider would, so the two never fight.
/** The localStorage key — IDENTICAL to @jeswr/app-shell's ThemeProvider. */
export const THEME_STORAGE_KEY = "app-shell-theme";
/** The dark-mode class toggled on <html> — IDENTICAL to app-shell. */
export const THEME_DARK_CLASS = "dark";
const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
/** Read the OS colour-scheme preference (defaults to light off-browser). */
export function systemPrefersDark() {
    if (!isBrowser || typeof window.matchMedia !== "function")
        return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
/** Read the persisted preference, validating the stored string. */
export function readStoredTheme() {
    if (!isBrowser)
        return null;
    try {
        const v = window.localStorage.getItem(THEME_STORAGE_KEY);
        return v === "light" || v === "dark" || v === "system" ? v : null;
    }
    catch {
        return null; // localStorage unavailable (private mode / blocked) — fall back.
    }
}
/** Persist the preference (best-effort; storage may be blocked). */
export function persistTheme(theme) {
    if (!isBrowser)
        return;
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
    catch {
        // Storage blocked — the in-memory state still drives the current page.
    }
}
/** Resolve a preference to the concrete mode, consulting the OS for "system". */
export function resolveTheme(theme) {
    if (theme === "system")
        return systemPrefersDark() ? "dark" : "light";
    return theme;
}
/**
 * Apply the resolved mode to <html>: toggle `.dark` and set `colorScheme`.
 * IDEMPOTENT and co-operative — writes the SAME class/property a host
 * ThemeProvider writes, so calling it when a provider is also present is
 * harmless (both converge on the same DOM state).
 */
export function applyResolvedTheme(resolved) {
    if (!isBrowser)
        return;
    const root = document.documentElement;
    root.classList.toggle(THEME_DARK_CLASS, resolved === "dark");
    root.style.colorScheme = resolved;
}
/** The cycle order for the toggle: light → dark → system → light. */
export function nextTheme(current) {
    switch (current) {
        case "light":
            return "dark";
        case "dark":
            return "system";
        default:
            return "light";
    }
}
