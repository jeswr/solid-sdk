// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
"use client";

import { useT } from "@jeswr/suite-i18n/react";
import { AppLauncher, type AppLauncherProps } from "./app-launcher.js";
import {
  AppGlyph,
  mobileApps,
  suiteApps,
  useNavigationApps,
  visibleNavigationApps,
} from "./apps.js";

export function BottomTabBar({
  currentApp,
  apps: suppliedApps = suiteApps,
  showBacklog = process.env.NEXT_PUBLIC_SHOW_BACKLOG_APPS === "1",
}: Omit<AppLauncherProps, "trigger">) {
  const t = useT();
  const apps = useNavigationApps(suppliedApps);
  const visible = visibleNavigationApps(apps, showBacklog);
  return (
    <nav className="suite-bottom-tabs" aria-label={t("navigation.apps")}>
      {mobileApps.map((slug) => {
        const app = visible.find((item) => item.slug === slug);
        return app ? (
          <a
            className="suite-tab"
            key={slug}
            href={app.basePath}
            aria-current={slug === currentApp ? "page" : undefined}
          >
            <AppGlyph app={slug} />
            <span>{app.name}</span>
          </a>
        ) : (
          <span key={slug} />
        );
      })}
      <AppLauncher currentApp={currentApp} apps={visible} showBacklog={showBacklog} trigger="tab" />
    </nav>
  );
}
