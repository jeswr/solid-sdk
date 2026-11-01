// AUTHORED-BY Codex GPT-6.1-Sol
import { APP_ICONS, type AppSlug, type CreateAction, suiteApps } from "@jeswr/suite-ui";
import type { SidebarSection } from "@jeswr/suite-ui/shell";

export interface AppDefinition {
  slug: AppSlug;
  name: string;
  hue: number;
  basePath: string;
  status: "first-cut" | "parity" | "backlog";
  sidebar?: (ctx: { pathname: string }) => SidebarSection[];
  create?: readonly CreateAction[];
  search?: { scopeLabel: string; types: string[] };
  shortcuts?: { keys: string; label: string }[];
}

export const appRegistry: readonly AppDefinition[] = suiteApps.map((app) => ({
  ...app,
  hue: APP_ICONS[app.slug].hue,
  ...(app.status !== "backlog"
    ? {
        sidebar: ({ pathname }: { pathname: string }): SidebarSection[] => [
          {
            id: app.slug,
            label: app.name,
            items: [
              {
                id: app.slug,
                label: app.name,
                href: app.basePath,
                current: pathname === app.basePath,
              },
            ],
          },
        ],
      }
    : {}),
}));

export function appForPath(pathname: string, apps = appRegistry): AppDefinition | undefined {
  return apps
    .filter((app) => pathname === app.basePath || pathname.startsWith(`${app.basePath}/`))
    .sort((a, b) => b.basePath.length - a.basePath.length)[0];
}

export function visibleApps(showBacklog: boolean): readonly AppDefinition[] {
  return appRegistry.filter((app) => showBacklog || app.status !== "backlog");
}
