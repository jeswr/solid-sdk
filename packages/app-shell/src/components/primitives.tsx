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
import type * as React from "react";
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

// ── Button (ghost / icon) ───────────────────────────────────────────────────

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: "ghost" | "outline";
  size?: "icon" | "default";
  /**
   * Whether to apply the defensive CSS-isolation reset (the `data-app-shell-control`
   * marker that `reset.css` targets). Default `true` — the shell's OWN chrome wants
   * it, so a consuming app's global `button {}` can't bleed in (#80). Set to `false`
   * (the ESCAPE HATCH) when an app uses this exported primitive to build its own
   * chrome and wants its `className` background/border to win unimpeded: an
   * un-marked button gets NO reset, so normal Tailwind utilities fully control it.
   */
  defensiveReset?: boolean;
}

export function Button({
  className,
  variant = "ghost",
  size = "default",
  type = "button",
  defensiveReset = true,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      // The marker is what `reset.css` keys on. Omit it (escape hatch) so a consumer
      // building custom chrome on the primitive keeps full `className` control.
      {...(defensiveReset ? { "data-app-shell-control": "" } : {})}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium",
        "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-as-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        "hover:bg-as-accent hover:text-as-accent-foreground",
        // The outline variant adds a border + a subtle base background so it
        // reads as a discrete control (used by the feedback submit/close buttons).
        variant === "outline" ? "border border-as-border bg-as-background" : "",
        size === "icon" ? "size-9" : "h-9 px-3 py-2",
        className,
      )}
      {...props}
    />
  );
}

// ── Avatar (Radix) ───────────────────────────────────────────────────────────

export function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      className={cn("relative flex size-7 shrink-0 overflow-hidden rounded-full", className)}
      {...props}
    />
  );
}

export function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      className={cn("aspect-square size-full object-cover", className)}
      {...props}
    />
  );
}

export function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-as-accent text-as-accent-foreground text-xs",
        className,
      )}
      {...props}
    />
  );
}

// ── DropdownMenu (Radix) ──────────────────────────────────────────────────────

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-md border border-as-border bg-as-popover p-1",
          "text-as-popover-foreground shadow-md",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
        "focus:bg-as-accent focus:text-as-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&>svg]:size-4 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2 py-1.5 text-sm font-medium", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-as-border", className)}
      {...props}
    />
  );
}
