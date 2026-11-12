// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";

import { useT } from "@jeswr/suite-i18n/react";
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { AppLauncher, type AppLauncherProps } from "./app-launcher.js";
import { AppGlyph, suiteApps, useNavigationApps, visibleNavigationApps } from "./apps.js";
import { usePreferences } from "./preferences.js";

export interface AppRailProps extends Omit<AppLauncherProps, "trigger"> {
  notifications?: ReactNode;
  offline?: ReactNode;
  account?: ReactNode;
}
export function AppRail({
  currentApp,
  apps: suppliedApps = suiteApps,
  showBacklog = process.env.NEXT_PUBLIC_SHOW_BACKLOG_APPS === "1",
  notifications,
  offline,
  account,
}: AppRailProps) {
  const t = useT();
  const apps = useNavigationApps(suppliedApps);
  const preferences = usePreferences("rail");
  const visible = visibleNavigationApps(apps, showBacklog);
  const pinned = [...new Set(preferences.value.pinned)]
    .map((slug) => visible.find((app) => app.slug === slug))
    .filter((app) => app !== undefined)
    .slice(0, 6);
  return (
    <nav className="suite-rail" aria-label={t("navigation.apps")}>
      <AppLauncher
        currentApp={currentApp}
        apps={visible}
        showBacklog={showBacklog}
        trigger="brand"
      />
      {preferences.status === "loading" ? (
        <div
          className="suite-rail-skeleton"
          role="status"
          aria-label={t("navigation.loadingPinned")}
        >
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
      <AppLauncher
        currentApp={currentApp}
        apps={visible}
        showBacklog={showBacklog}
        trigger="more"
      />
      <div className="suite-rail-bottom">
        {notifications}
        {offline}
        {account}
      </div>
    </nav>
  );
}
