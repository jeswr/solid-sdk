import { jsx as _jsx } from "react/jsx-runtime";
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// ThemeProvider — a FRAMEWORK-AGNOSTIC light/dark/system theme system for the
// Solid app suite. It is a from-scratch port of the Pod Manager behaviour
// (which used `next-themes`, a Next-only dep) onto plain React + the DOM, so the
// SAME component works under both Vite (the pod-* apps) and Next.js (PM,
// solid-issues). No next-themes, no next/* imports.
//
// Behaviour (matches PM's combined mode — the OS preference is the default, a
// header toggle writes a manual override):
//  - "system" (default): follow `prefers-color-scheme`, live (reacts to the OS
//    flipping while the app is open).
//  - "light" / "dark": a manual override, persisted to localStorage.
//  - The resolved mode toggles the `.dark` class on `document.documentElement`
//    (the same hook PM's `@custom-variant dark` and the suite tokens use).
//
// SSR-SAFE: all DOM/storage access is inside effects or guarded reads, so the
// provider renders harmlessly on the server (Next) and only touches the DOM in
// the browser. Apply the no-flash inline script (see `themeScript`) in the
// document <head> to avoid a light-mode flash before hydration.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, } from "react";
const ThemeContext = createContext(null);
/** Read the theme state anywhere under a <ThemeProvider>. */
export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) {
        throw new Error("useTheme must be used inside a <ThemeProvider>");
    }
    return ctx;
}
const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
/** Read the OS colour-scheme preference (defaults to light off-browser). */
function systemPrefersDark() {
    if (!isBrowser || typeof window.matchMedia !== "function")
        return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function readStored(storageKey) {
    if (!isBrowser || !storageKey)
        return null;
    try {
        const v = window.localStorage.getItem(storageKey);
        return v === "light" || v === "dark" || v === "system" ? v : null;
    }
    catch {
        return null; // localStorage unavailable (private mode / blocked) — fall back.
    }
}
function persist(storageKey, theme) {
    if (!isBrowser || !storageKey)
        return;
    try {
        window.localStorage.setItem(storageKey, theme);
    }
    catch {
        // Storage blocked — the in-memory state still drives the current page.
    }
}
/** Resolve a preference to the concrete mode, consulting the OS for "system". */
function resolve(theme) {
    if (theme === "system")
        return systemPrefersDark() ? "dark" : "light";
    return theme;
}
/**
 * App-wide theme provider. Wrap the app once (Vite: in `main.tsx`; Next: in a
 * client `providers.tsx`). Renders no DOM of its own.
 */
export function ThemeProvider({ children, defaultTheme = "system", storageKey = "app-shell-theme", attributeClass = "dark", }) {
    // Start from the default; reconcile to the stored value on mount so SSR markup
    // is deterministic (no hydration mismatch from reading storage during render).
    const [theme, setThemeState] = useState(defaultTheme);
    const [resolvedTheme, setResolvedTheme] = useState(() => resolve(defaultTheme));
    // On mount (and if the storageKey changes), adopt any persisted preference.
    // `theme` is intentionally NOT a dep: a later setTheme must not re-read storage
    // and clobber the user's just-made choice.
    useEffect(() => {
        const stored = readStored(storageKey);
        if (stored)
            setThemeState(stored);
    }, [storageKey]);
    // Apply the resolved mode to <html> + keep `resolvedTheme` in sync. Re-runs
    // when the preference changes; for "system" it also subscribes to OS changes.
    useEffect(() => {
        if (!isBrowser)
            return;
        const apply = () => {
            const next = resolve(theme);
            setResolvedTheme(next);
            const root = document.documentElement;
            root.classList.toggle(attributeClass, next === "dark");
            // Hint the UA for form controls / scrollbars (matches next-themes).
            root.style.colorScheme = next;
        };
        apply();
        if (theme !== "system" || typeof window.matchMedia !== "function")
            return;
        // Live-follow the OS while in "system" mode.
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        mq.addEventListener("change", apply);
        return () => mq.removeEventListener("change", apply);
    }, [theme, attributeClass]);
    const setTheme = useCallback((next) => {
        setThemeState(next);
        persist(storageKey, next);
    }, [storageKey]);
    const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
    return _jsx(ThemeContext.Provider, { value: value, children: children });
}
/**
 * A blocking inline script for the document <head> that sets the `.dark` class
 * BEFORE first paint, eliminating the light-flash on a dark-preference reload.
 * Inject it as `<script dangerouslySetInnerHTML={{ __html: themeScript() }} />`
 * (Next) or a literal `<script>` in `index.html` (Vite). It must use the SAME
 * storageKey + attributeClass as the provider.
 */
export function themeScript(storageKey = "app-shell-theme", attributeClass = "dark") {
    return `(function(){try{var t=localStorage.getItem(${JSON.stringify(storageKey)});var d=t==="dark"||((t===null||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle(${JSON.stringify(attributeClass)},d);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
}
