// AUTHORED-BY Codex GPT-6.1-Sol
import { classifySharedItem, type SharedItem, sharedItemName } from "@jeswr/suite-sdk/shared";
import type { DrivePreferences } from "@/apps/drive/state/prefs";
import { encodeRef } from "@/lib/refs";

export const sharedApps = [
  "docs",
  "sheets",
  "notes",
  "tasks",
  "calendar",
  "photos",
  "music",
  "drive",
] as const;
export const appLabel = (app: string) => app.charAt(0).toUpperCase() + app.slice(1);
export function openedSharedItems(entries: DrivePreferences["openedShared"]): SharedItem[] {
  return entries.map((entry) => ({
    url: entry.url,
    name: entry.name ?? sharedItemName(entry.url),
    ...classifySharedItem({
      url: entry.url,
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.contentType ? { contentType: entry.contentType } : {}),
    }),
    sharedAt: entry.openedAt,
    source: "opened",
  }));
}
/** Use the apps' existing encoded resource reference routes. */
export function sharedItemHref(item: SharedItem): string {
  const resource = new URL(item.url);
  resource.hash = "";
  const ref = encodeRef(resource.href);
  switch (item.app) {
    case "docs":
      return `/docs/d/${ref}`;
    case "sheets":
      return `/sheets/s/${ref}`;
    case "notes":
      return `/notes/n/${ref}`;
    case "tasks":
      return `/tasks/p/${ref}`;
    case "photos":
      return `/photos/${item.kind === "album" ? "a" : "p"}/${ref}`;
    case "calendar":
      return item.kind === "event" ? `/calendar/e/${ref}` : `/calendar/week?calendar=${ref}`;
    case "music":
      if (item.kind === "playlist") return `/music/p/${encodeRef(item.url)}`;
      if (item.kind === "album") return `/music/a/${encodeRef(item.url)}`;
      return `/music/search?q=${encodeURIComponent(item.name)}`;
    case "drive":
      return `/drive/${item.kind === "folder" ? "f" : "p"}/${ref}`;
  }
}
/** Display the sender assertion without fetching an untrusted third-party profile. */
export function sharedSender(value: string | undefined): string {
  if (!value) return "Unknown sender";
  try {
    return new URL(value).hostname || "Unknown sender";
  } catch {
    return value;
  }
}
