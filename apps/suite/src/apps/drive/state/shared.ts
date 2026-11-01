// AUTHORED-BY Codex
"use client";
import { useCallback } from "react";
import type { DriveItem } from "../lib/client/client";
import { isOwnStorage } from "../lib/client/ownership";
import { resolveContentType } from "../lib/files/resolve-content-type";
import { useDrive } from "./drive-context";
import type { DrivePreferences } from "./prefs";

/** Legacy preferences have no MIME; infer only a listing hint, never override declared metadata. */
export function sharedContentType(name: string, contentType?: string): string | undefined {
  return resolveContentType(name, contentType);
}

export function latestShared(
  entries: DrivePreferences["openedShared"],
): DrivePreferences["openedShared"] {
  const latest = new Map<string, DrivePreferences["openedShared"][number]>();
  for (const entry of entries) {
    const previous = latest.get(entry.url);
    if (!previous || Date.parse(entry.openedAt) >= Date.parse(previous.openedAt))
      latest.set(entry.url, entry);
  }
  return [...latest.values()].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
}

/** Called only after a successful open, using the existing account-scoped preference writer. */
export function useRecordSharedOpen() {
  const { session, updatePrefs } = useDrive();
  return useCallback(
    (item: DriveItem) => {
      if (isOwnStorage(item.url, session.storageUrl)) return;
      const entry = {
        url: item.url,
        name: item.name,
        type: item.kind,
        ...(item.contentType !== undefined ? { contentType: item.contentType } : {}),
        ...(item.size !== undefined ? { size: item.size } : {}),
        ...(item.modified ? { modified: item.modified.toISOString() } : {}),
        openedAt: new Date().toISOString(),
      };
      updatePrefs((current) => ({
        ...current,
        openedShared: latestShared([...current.openedShared, entry]),
      }));
    },
    [session.storageUrl, updatePrefs],
  );
}
