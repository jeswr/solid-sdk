import { jsx as _jsx } from "react/jsx-runtime";
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Minimal, self-contained shadcn-COMPATIBLE primitives the shell components are
// built from: a ghost <Button>, a Radix <Avatar>, and a Radix <DropdownMenu>.
// They are vendored here (not imported from a consumer's `@/components/ui/*`) so
// `@jeswr/app-shell` is self-sufficient: an app can drop in <ThemeToggle/> +
// <AccountMenu/> with NO shadcn scaffolding of its own. The class names match
// the shadcn token set, but through the shell-PRIVATE `as-` variants
// (bg-as-accent, text-as-muted-foreground, …) so they resolve to the suite
// palette in isolation from a consuming app overriding the public `--accent` /
// `--muted` tokens (CSS isolation, #80). See styles/theme.css + styles/reset.css.
//
// Radix is used directly (@radix-ui/react-*), not the `radix-ui` umbrella, so
// the dependency surface is explicit + tree-shakeable, and it works identically
// under Vite and Next.
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../lib/cn.js";
/**
 * The data attribute every app-shell control carries. `reset.css` (an UNLAYERED,
 * attribute-scoped defensive reset, shipped from the `styles.css` barrel) targets
 * `[data-app-shell-control]` so a consuming app's global element resets — a bare
 * `button {}` / `input {}` rule, which live UNLAYERED and therefore out-rank
 * Tailwind's layered utilities in the cascade — cannot bleed into the shell's own
 * controls. Specificity (0,1,1) of the attribute selector beats a bare element
 * selector (0,0,1), so the shell's intended look survives regardless of source
 * order or what the host's CSS does. See README "CSS isolation".
 */
export const APP_SHELL_CONTROL_ATTR = "data-app-shell-control";
export function Button({ className, variant = "ghost", size = "default", type = "button", defensiveReset = true, ...props }) {
    return (_jsx("button", { type: type, "data-variant": variant, "data-size": size, ...(defensiveReset ? { "data-app-shell-control": "" } : {}), className: cn("inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium", "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-as-ring", "disabled:pointer-events-none disabled:opacity-50", "hover:bg-as-accent hover:text-as-accent-foreground", 
        // The outline variant adds a border + a subtle base background so it
        // reads as a discrete control (used by the feedback submit/close buttons).
        variant === "outline" ? "border border-as-border bg-as-background" : "", size === "icon" ? "size-9" : "h-9 px-3 py-2", className), ...props }));
}
// ── Avatar (Radix) ───────────────────────────────────────────────────────────
export function Avatar({ className, ...props }) {
    return (_jsx(AvatarPrimitive.Root, { className: cn("relative flex size-7 shrink-0 overflow-hidden rounded-full", className), ...props }));
}
export function AvatarImage({ className, ...props }) {
    return (_jsx(AvatarPrimitive.Image, { className: cn("aspect-square size-full object-cover", className), ...props }));
}
export function AvatarFallback({ className, ...props }) {
    return (_jsx(AvatarPrimitive.Fallback, { className: cn("flex size-full items-center justify-center rounded-full bg-as-accent text-as-accent-foreground text-xs", className), ...props }));
}
// ── DropdownMenu (Radix) ──────────────────────────────────────────────────────
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export function DropdownMenuContent({ className, align = "end", sideOffset = 4, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Portal, { children: _jsx(DropdownMenuPrimitive.Content, { align: align, sideOffset: sideOffset, className: cn("z-50 min-w-[8rem] overflow-hidden rounded-md border border-as-border bg-as-popover p-1", "text-as-popover-foreground shadow-md", className), ...props }) }));
}
export function DropdownMenuItem({ className, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Item, { className: cn("relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none", "focus:bg-as-accent focus:text-as-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50", "[&>svg]:size-4 [&>svg]:shrink-0", className), ...props }));
}
export function DropdownMenuLabel({ className, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Label, { className: cn("px-2 py-1.5 text-sm font-medium", className), ...props }));
}
export function DropdownMenuSeparator({ className, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Separator, { className: cn("-mx-1 my-1 h-px bg-as-border", className), ...props }));
}
