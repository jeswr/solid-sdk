// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useState } from "react";
import { AppIcon } from "../components/atoms/app-icon.js";
import type { AppSlug, NavigationApp } from "./apps.js";

export function AppGrid({
  apps,
  currentApp,
  label,
  close,
  typeFilter,
}: {
  apps: readonly NavigationApp[];
  currentApp: AppSlug;
  label: string;
  close: () => void;
  typeFilter: (key: string) => void;
}) {
  const [active, setActive] = useState<AppSlug | undefined>();
  const selected = apps.some((app) => app.slug === active) ? active : apps[0]?.slug;
  const rows = Array.from({ length: Math.ceil(apps.length / 3) }, (_, i) =>
    apps.slice(i * 3, i * 3 + 3),
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: APG layout grid with native links, not tabular data.
    <div
      role="grid"
      aria-label={label}
      className="suite-app-grid"
      onKeyDown={(event) => {
        const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a"));
        const index = links.indexOf(event.target as HTMLAnchorElement);
        if (index < 0) return;
        let next = index;
        switch (event.key) {
          case "ArrowRight":
            next = index % 3 < 2 ? Math.min(index + 1, apps.length - 1) : index;
            break;
          case "ArrowLeft":
            next = index % 3 > 0 ? index - 1 : index;
            break;
          case "ArrowDown":
            next =
              Math.floor(index / 3) < rows.length - 1
                ? Math.min(index + 3, apps.length - 1)
                : index;
            break;
          case "ArrowUp":
            next = index >= 3 ? index - 3 : index;
            break;
          case "Home":
            next = event.ctrlKey ? 0 : Math.floor(index / 3) * 3;
            break;
          case "End":
            next = event.ctrlKey
              ? apps.length - 1
              : Math.min(Math.floor(index / 3) * 3 + 2, apps.length - 1);
            break;
          default:
            if (
              event.key.length === 1 &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              event.key !== " "
            ) {
              event.preventDefault();
              typeFilter(event.key);
            }
            return;
        }
        event.preventDefault();
        links[next]?.focus();
      }}
    >
      {rows.map((row) => (
        // biome-ignore lint/a11y/useSemanticElements: Layout grid row.
        // biome-ignore lint/a11y/useFocusableInteractive: Roving focus belongs to the link inside each cell.
        <div role="row" key={row[0]?.slug}>
          {row.map((app) => (
            // biome-ignore lint/a11y/useSemanticElements: Layout grid cell.
            // biome-ignore lint/a11y/useFocusableInteractive: The native link receives focus.
            <div role="gridcell" key={app.slug}>
              <a
                href={app.basePath}
                aria-current={app.slug === currentApp ? "page" : undefined}
                tabIndex={app.slug === selected ? 0 : -1}
                onFocus={() => setActive(app.slug)}
                onClick={close}
              >
                <AppIcon app={app.slug} decorative />
                <span>{app.name}</span>
              </a>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
