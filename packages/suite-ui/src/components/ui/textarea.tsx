// AUTHORED-BY Codex GPT-6.1-Sol
// Adapted from shadcn/ui (MIT), new-york-v4 registry. See THIRD_PARTY_NOTICES.md.
"use client";
import type * as React from "react";
import { cn } from "../../lib/utils.js";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-surface px-3 py-2 text-base  transition-[color,box-shadow]  placeholder:text-muted-foreground    disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive  md:text-base  ",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
