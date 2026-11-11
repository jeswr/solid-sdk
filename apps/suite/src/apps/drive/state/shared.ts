// AUTHORED-BY Codex
"use client";
import { latestSharedEntries } from "@jeswr/suite-sdk/shared";
import { useCallback } from "react";
import { clearHiddenSharedForAccount } from "@/lib/shared/hidden";
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
  return latestSharedEntries(entries, (entry) => entry.openedAt);
}

/** Called only after a successful open, using the existing account-scoped preference writer. */
export function useRecordSharedOpen() {
  const { session, updatePrefs } = useDrive();
  return useCallback(
    (item: DriveItem) => {
      if (isOwnStorage(item.url, session.storageUrl)) return;
      clearHiddenSharedForAccount(session.webId, item.url);
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
    [session.storageUrl, session.webId, updatePrefs],
  );
}
