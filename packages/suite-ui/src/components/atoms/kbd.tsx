// AUTHORED-BY Codex GPT-6.1-Sol
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.js";
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd className={cn("suite-kbd", className)} {...props} />;
}
