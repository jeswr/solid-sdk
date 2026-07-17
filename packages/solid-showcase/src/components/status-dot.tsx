// AUTHORED-BY Claude Fable 5
import { cn } from "@jeswr/app-shell";
import { type ServiceStatus, STATUS_LABELS } from "./use-service-status.js";

const DOT_CLASSES: Record<ServiceStatus, string> = {
  checking: "bg-muted-foreground/50",
  live: "bg-emerald-500",
  "not-deployed": "bg-amber-500",
};

/** Status dot + label; degradation stays visible and honest (never hidden). */
export function StatusDot({
  status,
  className,
}: {
  status: ServiceStatus;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs", className)}
      data-service-status={status}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", DOT_CLASSES[status])} />
      {STATUS_LABELS[status]}
    </span>
  );
}
