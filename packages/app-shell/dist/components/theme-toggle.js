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
const OPTIONS = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
];
/** Theme switcher (light / dark / system). Header-level, low-profile. */
export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    // Avoid a hydration mismatch (SSR renders a stable icon): only reflect the
    // real preference after mount, exactly as PM did with next-themes.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const Icon = !mounted ? Monitor : theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
    return (_jsxs(DropdownMenu, { children: [_jsx(DropdownMenuTrigger, { asChild: true, children: _jsx(Button, { variant: "ghost", size: "icon", "aria-label": "Change colour theme", children: _jsx(Icon, { className: "size-5", "aria-hidden": "true" }) }) }), _jsx(DropdownMenuContent, { align: "end", children: OPTIONS.map(({ value, label, icon: ItemIcon }) => (_jsxs(DropdownMenuItem, { onClick: () => setTheme(value), "aria-current": mounted && theme === value ? "true" : undefined, children: [_jsx(ItemIcon, { className: "size-4", "aria-hidden": "true" }), label] }, value))) })] }));
}
