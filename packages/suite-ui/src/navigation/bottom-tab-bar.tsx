// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";

import { AppLauncher, type AppLauncherProps } from "./app-launcher.js";
import { AppGlyph, mobileApps, suiteApps } from "./apps.js";

export function BottomTabBar({ currentApp, apps = suiteApps }: Omit<AppLauncherProps, "trigger">) {
  return (
    <nav className="suite-bottom-tabs" aria-label="Apps">
      {mobileApps.map((slug) => {
        const app = apps.find(
          (item) =>
            item.slug === slug &&
            (item.status !== "backlog" || process.env.NEXT_PUBLIC_SHOW_BACKLOG_APPS === "1"),
        );
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
      <AppLauncher currentApp={currentApp} apps={apps} trigger="tab" />
    </nav>
  );
}
