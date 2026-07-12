import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// ThemeToggle — the header-level light / dark / system switcher. A from-scratch
// port of PM's `theme-toggle.tsx` onto the framework-agnostic `useTheme` (no
// next-themes). Drop it in the top-right next to <AccountMenu/>.
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, } from "./primitives.js";
import { useTheme } from "./theme-provider.js";
/**
 * The icon per preference. An exhaustive `Record<Theme, …>` (index-safe by the
 * closed `Theme` union) — the single source of truth for both the trigger icon
 * and the menu items below. It replaces a chained ternary; if `Theme` ever gains
 * a member, the compiler requires an entry here.
 */
const THEME_ICON = {
    light: Sun,
    dark: Moon,
    system: Monitor,
};
const OPTIONS = [
    { value: "light", label: "Light", icon: THEME_ICON.light },
    { value: "dark", label: "Dark", icon: THEME_ICON.dark },
    { value: "system", label: "System", icon: THEME_ICON.system },
];
/** Theme switcher (light / dark / system). Header-level, low-profile. */
export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    // Avoid a hydration mismatch (SSR renders a stable icon): only reflect the
    // real preference after mount, exactly as PM did with next-themes.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    // Before mount the icon is the SSR-stable "system" icon (Monitor); after mount
    // it follows the resolved preference. (system → Monitor, dark → Moon, light → Sun.)
    const Icon = mounted ? THEME_ICON[theme] : THEME_ICON.system;
    return (_jsxs(DropdownMenu, { children: [_jsx(DropdownMenuTrigger, { asChild: true, children: _jsx(Button, { variant: "ghost", size: "icon", "aria-label": "Change colour theme", children: _jsx(Icon, { className: "size-5", "aria-hidden": "true" }) }) }), _jsx(DropdownMenuContent, { align: "end", children: OPTIONS.map(({ value, label, icon: ItemIcon }) => (_jsxs(DropdownMenuItem, { onClick: () => setTheme(value), "aria-current": mounted && theme === value ? "true" : undefined, children: [_jsx(ItemIcon, { className: "size-4", "aria-hidden": "true" }), label] }, value))) })] }));
}
