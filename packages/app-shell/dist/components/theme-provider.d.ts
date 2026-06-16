import { type ReactNode } from "react";
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export interface ThemeContextValue {
    /** The user's selected preference: light / dark / system. */
    theme: Theme;
    /** The concrete mode actually applied right now (system → resolved). */
    resolvedTheme: ResolvedTheme;
    /** Set the preference. Persists to localStorage (unless storageKey=null). */
    setTheme: (theme: Theme) => void;
}
/** Read the theme state anywhere under a <ThemeProvider>. */
export declare function useTheme(): ThemeContextValue;
export interface ThemeProviderProps {
    children: ReactNode;
    /** Initial preference before any stored value is read (default "system"). */
    defaultTheme?: Theme;
    /**
     * localStorage key the preference is persisted under. Pass `null` to disable
     * persistence (the theme is then per-page-load). Default: "app-shell-theme".
     */
    storageKey?: string | null;
    /** The element class toggled for dark mode. Default "dark" (suite convention). */
    attributeClass?: string;
}
/**
 * App-wide theme provider. Wrap the app once (Vite: in `main.tsx`; Next: in a
 * client `providers.tsx`). Renders no DOM of its own.
 */
export declare function ThemeProvider({ children, defaultTheme, storageKey, attributeClass, }: ThemeProviderProps): import("react").JSX.Element;
/**
 * A blocking inline script for the document <head> that sets the `.dark` class
 * BEFORE first paint, eliminating the light-flash on a dark-preference reload.
 * Inject it as `<script dangerouslySetInnerHTML={{ __html: themeScript() }} />`
 * (Next) or a literal `<script>` in `index.html` (Vite). It must use the SAME
 * storageKey + attributeClass as the provider.
 */
export declare function themeScript(storageKey?: string, attributeClass?: string): string;
