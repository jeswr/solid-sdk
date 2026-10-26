// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import {
  Calendar,
  ContactRound,
  FileText,
  HardDrive,
  HeartPulse,
  House,
  Image,
  Mail,
  MessageCircle,
  Music2,
  ShieldCheck,
  SquareCheck,
  StickyNote,
  Table2,
  Wallet,
} from "lucide-react";
import type { CSSProperties } from "react";

export const appGlyphs = {
  home: House,
  drive: HardDrive,
  docs: FileText,
  tasks: SquareCheck,
  calendar: Calendar,
  contacts: ContactRound,
  notes: StickyNote,
  photos: Image,
  chat: MessageCircle,
  sheets: Table2,
  mail: Mail,
  music: Music2,
  money: Wallet,
  health: HeartPulse,
  permissions: ShieldCheck,
};
export type AppSlug = keyof typeof appGlyphs;
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
  const Icon = appGlyphs[app];
  return <Icon size={size} strokeWidth={size === 24 ? 1.5 : 1.75} aria-hidden="true" />;
}
export function AppIcon({ app, size = 40 }: { app: AppSlug; size?: 32 | 40 | 48 }) {
  return (
    <span
      className="suite-app-icon"
      aria-hidden="true"
      style={
        { width: size, height: size, "--app-icon-color": `var(--app-${app})` } as CSSProperties
      }
    >
      <svg viewBox="0 0 40 40" focusable="false" aria-hidden="true">
        <polygon points="20,4 34,12 34,28 20,36 6,28 6,12" />
      </svg>
      <AppGlyph app={app} />
    </span>
  );
}
