export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
/** The localStorage key — IDENTICAL to @jeswr/app-shell's ThemeProvider. */
export declare const THEME_STORAGE_KEY = "app-shell-theme";
/** The dark-mode class toggled on <html> — IDENTICAL to app-shell. */
export declare const THEME_DARK_CLASS = "dark";
/** Read the OS colour-scheme preference (defaults to light off-browser). */
export declare function systemPrefersDark(): boolean;
/** Read the persisted preference, validating the stored string. */
export declare function readStoredTheme(): Theme | null;
/** Persist the preference (best-effort; storage may be blocked). */
export declare function persistTheme(theme: Theme): void;
/** Resolve a preference to the concrete mode, consulting the OS for "system". */
export declare function resolveTheme(theme: Theme): ResolvedTheme;
/**
 * Apply the resolved mode to <html>: toggle `.dark` and set `colorScheme`.
 * IDEMPOTENT and co-operative — writes the SAME class/property a host
 * ThemeProvider writes, so calling it when a provider is also present is
 * harmless (both converge on the same DOM state).
 */
export declare function applyResolvedTheme(resolved: ResolvedTheme): void;
/** The cycle order for the toggle: light → dark → system → light. */
export declare function nextTheme(current: Theme): Theme;
