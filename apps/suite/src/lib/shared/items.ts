// AUTHORED-BY Codex GPT-6.1-Sol
import {
  classifySharedItem,
  resolveSuiteResource,
  type SharedItem,
  sharedItemName,
} from "@jeswr/suite-sdk/shared";
import type { DrivePreferences } from "@/apps/drive/state/prefs";
import { encodeRef } from "@/lib/refs";

export { sharedApps } from "@jeswr/suite-sdk/shared";
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
    ...(entry.contentType ? { contentType: entry.contentType } : {}),
    sharedAt: entry.openedAt,
    source: "opened",
  }));
}
/** Use the apps' existing encoded resource reference routes. */
export function sharedItemHref(item: SharedItem, storageUrl?: string): string {
  return resolveSuiteResource(
    {
      url: item.url,
      // Titles are unverified display text, never routing evidence.
      ...(item.contentType ? { contentType: item.contentType } : {}),
      ...(item.rdfTypes ? { rdfTypes: item.rdfTypes } : {}),
    },
    {
      encodeRef,
      shared: true,
      ...(storageUrl ? { storageUrl } : {}),
      previewOnly:
        item.source === "inbox" &&
        (item.fromAnotherPod === true ||
          !storageUrl ||
          new URL(item.url).origin !== new URL(storageUrl).origin),
    },
  ).href;
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
