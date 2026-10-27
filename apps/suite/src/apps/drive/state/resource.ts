// AUTHORED-BY Codex
"use client";

import { useEffect, useState } from "react";
import { type DriveClient, type DriveItem, parentOf } from "../lib/client/client";
import { useDrive } from "./drive-context";

/** Resource writes and local uploads invalidate the same parent channel as its listing. */
export function useResourceVersion(url: string | undefined): number {
  const { changes } = useDrive();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const parent = url ? parentOf(url) : undefined;
    if (!parent) return;
    return changes.subscribe(parent, () => setVersion((current) => current + 1));
  }, [url, changes]);
  return version;
}

export function useLiveItem(initial: DriveItem): DriveItem;
export function useLiveItem(initial: DriveItem | undefined): DriveItem | undefined;
/** Revalidate on opening, new listing metadata and changes, including missed notifications. */
export function useLiveItem(initial: DriveItem | undefined): DriveItem | undefined {
  const { client } = useDrive();
  const version = useResourceVersion(initial?.url);
  const [snapshot, setSnapshot] = useState<{
    client: DriveClient;
    source: DriveItem;
    item: DriveItem;
  }>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: version invalidates the resource metadata
  useEffect(() => {
    if (!initial) return;
    // A newer source or invalidation supersedes this HEAD, even for the same URL.
    let live = true;
    client.stat(initial.url).then(
      (item) => live && setSnapshot({ client, source: initial, item }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [client, initial, version]);
  return snapshot?.client === client && snapshot.source === initial ? snapshot.item : initial;
}
