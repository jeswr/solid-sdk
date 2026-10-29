// AUTHORED-BY Codex
"use client";

import { useEffect, useRef, useState } from "react";
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
  return useLiveResource(initial).item;
}

// Client identity scopes metadata to the account and transport that hydrated it.
const hydrated = new WeakMap<DriveClient, Map<string, DriveItem>>();

/** Freshly read metadata takes precedence over a persisted, unversioned preference row. */
export function withHydratedMetadata<T extends DriveItem>(client: DriveClient, item: T): T {
  const known = hydrated.get(client)?.get(item.url);
  return known && (item.etag === undefined || item.etag === known.etag)
    ? { ...item, ...known, name: item.name }
    : item;
}

function metadataKey(item: DriveItem): string {
  return JSON.stringify([
    item.url,
    item.etag,
    item.contentType,
    item.size,
    item.modified?.getTime(),
  ]);
}

/** A preview waits for its opening HEAD before reading bytes, avoiding an unversioned first GET. */
export function useLiveResource(initial: DriveItem | undefined, activationId?: string) {
  const { client } = useDrive();
  const version = useResourceVersion(initial?.url);
  const key = initial ? metadataKey(initial) : undefined;
  const [snapshot, setSnapshot] = useState<{
    client: DriveClient;
    sourceKey: string;
    activationId: string | undefined;
    version: number;
    status: "ready" | "error";
    item: DriveItem;
  }>();
  const latest = useRef(snapshot);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key includes the source URL and metadata values, excluding object identity
  useEffect(() => {
    if (!initial || !key) {
      latest.current = undefined;
      setSnapshot(undefined);
      return;
    }
    const previous = latest.current;
    if (
      previous?.client === client &&
      previous.activationId === activationId &&
      previous.version === version &&
      metadataKey(previous.item) === key
    )
      return;
    // A newer source or invalidation supersedes this HEAD, even for the same URL.
    let live = true;
    const complete = (item: DriveItem, status: "ready" | "error") => {
      if (!live) return;
      if (status === "ready") {
        const items = hydrated.get(client) ?? new Map<string, DriveItem>();
        items.set(item.url, item);
        hydrated.set(client, items);
      }
      const next = { client, sourceKey: key, activationId, version, status, item };
      latest.current = next;
      setSnapshot(next);
    };
    client.stat(initial.url).then(
      (item) => complete(item, "ready"),
      () => complete(initial, "error"),
    );
    return () => {
      live = false;
    };
  }, [client, key, version, activationId]);
  const current =
    snapshot?.client === client &&
    snapshot.activationId === activationId &&
    // Keep the current representation visible during background revalidation.
    // The resolving HEAD replaces it only if this resource actually changed.
    (snapshot.sourceKey === key || metadataKey(snapshot.item) === key)
      ? snapshot
      : undefined;
  return { item: current?.item ?? initial, status: current?.status ?? ("loading" as const) };
}
