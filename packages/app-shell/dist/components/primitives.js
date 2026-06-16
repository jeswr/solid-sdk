import { jsx as _jsx } from "react/jsx-runtime";
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Minimal, self-contained shadcn-COMPATIBLE primitives the shell components are
// built from: a ghost <Button>, a Radix <Avatar>, and a Radix <DropdownMenu>.
// They are vendored here (not imported from a consumer's `@/components/ui/*`) so
// `@jeswr/app-shell` is self-sufficient: an app can drop in <ThemeToggle/> +
// <AccountMenu/> with NO shadcn scaffolding of its own. The class names match
// the shadcn token set (bg-accent, text-muted-foreground, …) so they inherit
// whatever palette the consuming app's tokens.css defines — including ours.
//
// Radix is used directly (@radix-ui/react-*), not the `radix-ui` umbrella, so
// the dependency surface is explicit + tree-shakeable, and it works identically
// under Vite and Next.
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../lib/cn.js";
export function Button({ className, variant = "ghost", size = "default", type = "button", ...props }) {
    return (_jsx("button", { type: type, "data-variant": variant, "data-size": size, className: cn("inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium", "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", "disabled:pointer-events-none disabled:opacity-50", "hover:bg-accent hover:text-accent-foreground", size === "icon" ? "size-9" : "h-9 px-3 py-2", className), ...props }));
}
// ── Avatar (Radix) ───────────────────────────────────────────────────────────
export function Avatar({ className, ...props }) {
    return (_jsx(AvatarPrimitive.Root, { className: cn("relative flex size-7 shrink-0 overflow-hidden rounded-full", className), ...props }));
}
export function AvatarImage({ className, ...props }) {
    return (_jsx(AvatarPrimitive.Image, { className: cn("aspect-square size-full object-cover", className), ...props }));
}
export function AvatarFallback({ className, ...props }) {
    return (_jsx(AvatarPrimitive.Fallback, { className: cn("flex size-full items-center justify-center rounded-full bg-accent text-accent-foreground text-xs", className), ...props }));
}
// ── DropdownMenu (Radix) ──────────────────────────────────────────────────────
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export function DropdownMenuContent({ className, align = "end", sideOffset = 4, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Portal, { children: _jsx(DropdownMenuPrimitive.Content, { align: align, sideOffset: sideOffset, className: cn("z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1", "text-popover-foreground shadow-md", className), ...props }) }));
}
export function DropdownMenuItem({ className, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Item, { className: cn("relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none", "focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50", "[&>svg]:size-4 [&>svg]:shrink-0", className), ...props }));
}
export function DropdownMenuLabel({ className, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Label, { className: cn("px-2 py-1.5 text-sm font-medium", className), ...props }));
}
export function DropdownMenuSeparator({ className, ...props }) {
    return (_jsx(DropdownMenuPrimitive.Separator, { className: cn("-mx-1 my-1 h-px bg-border", className), ...props }));
}
