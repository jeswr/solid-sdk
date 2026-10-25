// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { ComponentProps } from "react";
import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip.js";

export type IconButtonProps = Omit<
  ComponentProps<typeof Button>,
  "aria-label" | "aria-labelledby" | "asChild" | "size"
> & {
  label: string;
  size?: "icon" | "icon-sm";
};

/** The label is shared by the accessible name and the hover/focus tooltip. */
export function IconButton({ label, size = "icon", disabled, ...props }: IconButtonProps) {
  if (!label.trim()) throw new Error("IconButton requires a non-empty label");
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            {...props}
            size={size}
            aria-label={label}
            aria-disabled={disabled || undefined}
            onClick={disabled ? (event) => event.preventDefault() : props.onClick}
          />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
