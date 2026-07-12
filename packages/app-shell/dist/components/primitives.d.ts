import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type * as React from "react";
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
export declare const APP_SHELL_CONTROL_ATTR = "data-app-shell-control";
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
export declare function Button({ className, variant, size, type, defensiveReset, ...props }: ButtonProps): React.JSX.Element;
export declare function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>): React.JSX.Element;
export declare function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>): React.JSX.Element;
export declare function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>): React.JSX.Element;
export declare const DropdownMenu: React.FC<DropdownMenuPrimitive.DropdownMenuProps>;
export declare const DropdownMenuTrigger: React.ForwardRefExoticComponent<DropdownMenuPrimitive.DropdownMenuTriggerProps & React.RefAttributes<HTMLButtonElement>>;
export declare function DropdownMenuContent({ className, align, sideOffset, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>): React.JSX.Element;
export declare function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>): React.JSX.Element;
export declare function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>): React.JSX.Element;
export declare function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>): React.JSX.Element;
