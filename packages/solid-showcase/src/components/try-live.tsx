// AUTHORED-BY Claude Fable 5
"use client";

import { cn } from "@jeswr/app-shell";
import { registeredApp } from "../document.js";
import type { ServiceRegistry } from "../schema.js";
import { type ServiceStatus, useServiceStatuses } from "./use-service-status.js";

export interface TryLiveButtonProps {
  registry: ServiceRegistry;
  /** Key of `registry.apps`. */
  app: string;
  label: string;
  className?: string | undefined;
}

/**
 * "Try this live" deep link. When the target zone is not deployed the control stays
 * VISIBLE but disabled — a placeholder link (no href, no handler) with aria-disabled and
 * an explanation — so the story remains honest about what is wired in this environment
 * and nothing can navigate into a failing zone (middle-click included).
 */
export function TryLiveButton({ registry, app, label, className }: TryLiveButtonProps) {
  const target = registeredApp(registry, app);
  const statuses = useServiceStatuses([target.healthPath]);
  const status: ServiceStatus = statuses[target.healthPath] ?? "checking";

  if (status === "live") {
    return (
      <a
        className={cn(
          "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground text-sm transition-opacity hover:opacity-90",
          className,
        )}
        data-try-live={app}
        href={target.path}
      >
        {label}
        <span aria-hidden="true">→</span>
      </a>
    );
  }

  return (
    <span className={cn("inline-flex flex-col gap-1", className)}>
      {/* biome-ignore lint/a11y/useValidAnchor: an href-less anchor is the HTML-spec
          placeholder-link form for a disabled link — keeping href + preventDefault would
          still navigate on middle-click / open-in-new-tab. */}
      <a
        aria-disabled="true"
        className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-border bg-muted px-4 py-2 font-medium text-muted-foreground text-sm"
        data-try-live={app}
        data-try-live-disabled=""
      >
        {label}
      </a>
      <span className="text-muted-foreground text-xs">
        {status === "checking"
          ? "Checking whether this app is deployed…"
          : `${target.appName} is not deployed in this environment — the step still reads honestly without it.`}
      </span>
    </span>
  );
}
