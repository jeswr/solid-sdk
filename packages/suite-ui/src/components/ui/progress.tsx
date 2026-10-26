// AUTHORED-BY Codex GPT-6.1-Sol
// Adapted from shadcn/ui (MIT), new-york-v4 registry. See THIRD_PARTY_NOTICES.md.
"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "../../lib/utils.js";

function Progress({
  className,
  value,
  max,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  // Match Radix's fallback maximum and indeterminate-value handling.
  const maximum = typeof max === "number" && !Number.isNaN(max) && max > 0 ? max : 100;
  const percentage =
    typeof value === "number" && value >= 0 && value <= maximum ? (value / maximum) * 100 : 0;
  return (
    <ProgressPrimitive.Root
      value={value ?? null}
      {...(max === undefined ? {} : { max })}
      data-slot="progress"
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-surface-3", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary"
        style={{ transform: `translateX(-${100 - percentage}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
