// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * Drive preferences (04-drive §5.2 prefs schema) kept in localStorage per
 * account until `usePreferences("drive")` (SDK-APP-11) stores them in the pod.
 */

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

export const drivePreferencesSchema = z.object({
  starred: z.array(z.string()).default([]),
  openedShared: z.array(z.object({ url: z.string(), openedAt: z.string() })).default([]),
  view: z.enum(["list", "grid"]).default("list"),
  sort: z
    .object({ key: z.enum(["name", "modified", "size"]), dir: z.enum(["asc", "desc"]) })
    .default({ key: "name", dir: "asc" }),
});
export type DrivePreferences = z.infer<typeof drivePreferencesSchema>;

const DEFAULTS = drivePreferencesSchema.parse({});
const listeners = new Set<() => void>();

function keyFor(webId: string): string {
  return `suite.drive.prefs.${webId}`;
}

function load(webId: string): DrivePreferences {
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
      } catch {
        // Storage can be unavailable (private mode); keep the in-memory value.
      }
      setPrefs(next);
      for (const listener of listeners) listener();
    },
    [webId],
  );
  return [prefs, update] as const;
}
