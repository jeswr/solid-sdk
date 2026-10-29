// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { AppLauncher, type AppLauncherProps } from "./app-launcher.js";
import { AppGlyph, suiteApps } from "./apps.js";
import { usePreferences } from "./preferences.js";

export interface AppRailProps extends Omit<AppLauncherProps, "trigger"> {
  notifications?: ReactNode;
  offline?: ReactNode;
  account?: ReactNode;
}
export function AppRail({
  currentApp,
  apps = suiteApps,
  notifications,
  offline,
  account,
}: AppRailProps) {
  const preferences = usePreferences("rail");
  const visible = apps.filter(
    (app) => app.status !== "backlog" || process.env.NEXT_PUBLIC_SHOW_BACKLOG_APPS === "1",
  );
  const pinned = [...new Set(preferences.value.pinned)]
    .map((slug) => visible.find((app) => app.slug === slug))
    .filter((app) => app !== undefined)
    .slice(0, 6);
  return (
    <nav className="suite-rail" aria-label="Apps">
      <AppLauncher currentApp={currentApp} apps={apps} trigger="brand" />
      {preferences.status === "loading" ? (
        <div className="suite-rail-skeleton" role="status" aria-label="Loading pinned apps">
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : (
        pinned.map((app) => (
          <TooltipProvider key={app.slug}>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  className="suite-rail-button"
                  href={app.basePath}
                  aria-label={app.name}
                  aria-current={app.slug === currentApp ? "page" : undefined}
                >
                  <AppGlyph app={app.slug} />
                </a>
              </TooltipTrigger>
              <TooltipContent side="right">{app.name}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))
      )}
      <AppLauncher currentApp={currentApp} apps={apps} trigger="more" />
      <div className="suite-rail-bottom">
        {notifications}
        {offline}
        {account}
      </div>
    </nav>
  );
}
