// AUTHORED-BY Claude Opus 4.8
import { CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Solid Issues wordmark — a CircleDot (the issue tracker glyph) + the
 * product name.  Matches the PM app-shell's Brand shape so it can be dropped
 * into the shared sidebar unchanged while keeping the Solid Issues identity.
 *
 * Pending pss-70t (maintainer decision on wordmark): this component defaults
 * to "Solid Issues" rather than "Pod Manager" to keep the suite-consistent
 * shell while preserving the app's own wordmark.
 */
export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"
      >
        <CircleDot className="size-5" />
      </span>
      <span className="text-base font-semibold tracking-tight">Solid Issues</span>
    </span>
  );
}
