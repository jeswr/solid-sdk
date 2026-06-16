import * as AvatarPrimitive from "@radix-ui/react-avatar";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type * as React from "react";
export interface ButtonProps extends React.ComponentProps<"button"> {
    variant?: "ghost";
    size?: "icon" | "default";
}
export declare function Button({ className, variant, size, type, ...props }: ButtonProps): React.JSX.Element;
export declare function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>): React.JSX.Element;
export declare function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>): React.JSX.Element;
export declare function AvatarFallback({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Fallback>): React.JSX.Element;
export declare const DropdownMenu: React.FC<DropdownMenuPrimitive.DropdownMenuProps>;
export declare const DropdownMenuTrigger: React.ForwardRefExoticComponent<DropdownMenuPrimitive.DropdownMenuTriggerProps & React.RefAttributes<HTMLButtonElement>>;
export declare function DropdownMenuContent({ className, align, sideOffset, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>): React.JSX.Element;
export declare function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>): React.JSX.Element;
export declare function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>): React.JSX.Element;
export declare function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>): React.JSX.Element;
