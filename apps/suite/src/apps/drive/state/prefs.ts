// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/**
 * Drive preferences (04-drive §5.2 prefs schema) kept in localStorage per
 * account until `usePreferences("drive")` (SDK-APP-11) stores them in the pod.
 */

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

export const drivePreferencesSchema = z.object({
  starred: z.array(z.string()).default([]),
  openedShared: z
    .array(
      z.object({
        url: z.string(),
        openedAt: z.string(),
        name: z.string().optional(),
        type: z.enum(["file", "folder"]).optional(),
        contentType: z.string().optional(),
        size: z.number().int().nonnegative().optional(),
        modified: z.iso.datetime({ offset: true }).optional(),
      }),
    )
    .default([]),
  view: z.enum(["list", "grid"]).default("list"),
  sort: z
    .object({ key: z.enum(["name", "modified", "size"]), dir: z.enum(["asc", "desc"]) })
    .default({ key: "name", dir: "asc" }),
});
export type DrivePreferences = z.infer<typeof drivePreferencesSchema>;

const DEFAULTS = drivePreferencesSchema.parse({});
const listeners = new Set<() => void>();
/** Preferences that storage refused to save, kept for the rest of the session. */
const unsaved = new Map<string, DrivePreferences>();

function keyFor(webId: string): string {
  return `suite.drive.prefs.${webId}`;
}

function load(webId: string): DrivePreferences {
  const memory = unsaved.get(keyFor(webId));
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(keyFor(webId));
    if (!raw) return DEFAULTS;
    const parsed = drivePreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function useDrivePreferences(webId: string) {
  const [prefs, setPrefs] = useState<DrivePreferences>(DEFAULTS);
  useEffect(() => {
    const sync = () => setPrefs(load(webId));
    sync();
    listeners.add(sync);
    const onStorage = (event: StorageEvent) => event.key === keyFor(webId) && sync();
    addEventListener("storage", onStorage);
    return () => {
      listeners.delete(sync);
      removeEventListener("storage", onStorage);
    };
  }, [webId]);
  const update = useCallback(
    (change: (current: DrivePreferences) => DrivePreferences) => {
      const next = change(load(webId));
      try {
        localStorage.setItem(keyFor(webId), JSON.stringify(next));
        unsaved.delete(keyFor(webId));
      } catch {
        // Storage can be unavailable (private mode or full); keep the value in memory
        // so listeners reloading preferences do not revert it.
        unsaved.set(keyFor(webId), next);
      }
      setPrefs(next);
      for (const listener of listeners) listener();
    },
    [webId],
  );
  return [prefs, update] as const;
}
