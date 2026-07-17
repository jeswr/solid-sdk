// AUTHORED-BY Claude Fable 5
"use client";

import { cn } from "@jeswr/app-shell";
import { useId, useState } from "react";
import { launcherApps } from "../document.js";
import type { ServiceRegistry } from "../schema.js";
import { StatusDot } from "./status-dot.js";
import { useServiceStatuses } from "./use-service-status.js";

export interface LauncherProps {
  registry: ServiceRegistry;
}

/**
 * Persistent launcher dock: every app in the suite with a live status dot, driven by the
 * single service registry (`registry.launcherOrder`). Rendered on every page from the
 * layout. Undeployed zones stay listed — honest degradation, not omission.
 */
export function Launcher({ registry }: LauncherProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const apps = launcherApps(registry);
  const statuses = useServiceStatuses(apps.map((app) => app.healthPath));

  return (
    <div className="fixed right-4 bottom-16 z-40 flex flex-col items-end gap-2" data-launcher="">
      {open && (
        <div
          className="w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-3 shadow-xl"
          id={panelId}
        >
          <p className="px-2 pb-2 font-semibold text-card-foreground text-sm">Apps in this demo</p>
          <ul className="flex flex-col">
            {apps.map((app) => {
              const status = statuses[app.healthPath] ?? "checking";
              const live = status === "live";
              return (
                <li key={app.slug}>
                  {/* Same accessible-disabled pattern as TryLiveButton: a zone that is
                      not live renders as a placeholder link (no href, no handler,
                      aria-disabled) so nothing navigates into a failing zone. */}
                  <a
                    aria-disabled={live ? undefined : "true"}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg px-2 py-2",
                      live ? "hover:bg-muted" : "cursor-not-allowed opacity-80",
                    )}
                    data-launcher-app={app.slug}
                    href={live ? app.path : undefined}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-card-foreground text-sm">
                        {app.appName}
                      </span>
                      <span className="block truncate text-muted-foreground text-xs">
                        {app.modelledOn}
                      </span>
                    </span>
                    <StatusDot className="shrink-0" status={status} />
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="px-2 pt-2 text-muted-foreground text-xs">
            Zones marked “Not deployed” are not wired in this environment.
          </p>
        </div>
      )}
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className="rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground text-sm shadow-lg transition-opacity hover:opacity-90"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? "Close" : "Apps"}
      </button>
    </div>
  );
}
