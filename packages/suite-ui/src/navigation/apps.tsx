// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";

import { APP_ICONS, type AppId } from "../components/atoms/app-icon.js";

/** Navigation slugs are the DS-02 AppIcon ids, so every app has one glyph and hue. */
export type AppSlug = AppId;
export interface CreateAction {
  id: string;
  label: string;
  onSelect: () => void;
}
export interface NavigationApp {
  slug: AppSlug;
  name: string;
  basePath: string;
  status: "first-cut" | "parity" | "backlog";
  create?: readonly CreateAction[];
}
export const suiteApps: readonly NavigationApp[] = [
  { slug: "home", name: "Home", basePath: "/home", status: "first-cut" },
  { slug: "drive", name: "Drive", basePath: "/drive", status: "first-cut" },
  { slug: "docs", name: "Docs", basePath: "/docs", status: "first-cut" },
  { slug: "tasks", name: "Tasks", basePath: "/tasks", status: "first-cut" },
  { slug: "permissions", name: "Permissions", basePath: "/permissions", status: "first-cut" },
  ...(
    [
      "calendar",
      "contacts",
      "notes",
      "photos",
      "chat",
      "sheets",
      "mail",
      "music",
      "money",
      "health",
    ] as const
  ).map((slug) => ({
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    basePath: `/${slug}`,
    status: "backlog" as const,
  })),
];
export const defaultRailPins: readonly AppSlug[] = [
  "home",
  "drive",
  "docs",
  "tasks",
  "permissions",
];
export const mobileApps: readonly AppSlug[] = ["home", "drive", "docs", "tasks"];

export function AppGlyph({ app, size = 20 }: { app: AppSlug; size?: 20 | 24 }) {
  const Icon = APP_ICONS[app].icon;
  return <Icon size={size} strokeWidth={size === 24 ? 1.5 : 1.75} aria-hidden="true" />;
}
