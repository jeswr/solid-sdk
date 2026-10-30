// AUTHORED-BY Codex
"use client";

import { useEffect, useRef, useState } from "react";
import { type DriveClient, type DriveItem, parentOf } from "../lib/client/client";
import { useDrive } from "./drive-context";

/** Resource writes and local uploads invalidate the same parent channel as its listing. */
export function useResourceVersion(url: string | undefined): number {
  return useResourceVersions(url ? [url] : []);
}

function useResourceVersions(urls: readonly string[]): number {
  const { changes } = useDrive();
  const [version, setVersion] = useState(0);
  const parents = JSON.stringify([...new Set(urls.map(parentOf).filter(Boolean))].sort());
  useEffect(() => {
    const unsubscribe = (JSON.parse(parents) as string[]).map((parent) =>
      changes.subscribe(parent, () => setVersion((current) => current + 1)),
    );
    return () => {
      for (const stop of unsubscribe) stop();
    };
  }, [parents, changes]);
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

/** Every member follows its own parent channel, even after leaving the visible listing. */
export function useLiveItems(initial: readonly DriveItem[]): readonly DriveItem[] {
  return useLiveResources(initial).map((resource) => resource.item);
}

/** A preview waits for its opening HEAD before reading bytes, avoiding an unversioned first GET. */
export function useLiveResource(initial: DriveItem | undefined, activationId?: string) {
  const [resource] = useLiveResources(initial ? [initial] : [], activationId);
  return resource ?? { item: initial, status: "loading" as const };
}

function useLiveResources(initial: readonly DriveItem[], activationId?: string) {
  const { client } = useDrive();
  const version = useResourceVersions(initial.map((item) => item.url));
  const key = JSON.stringify(initial.map(metadataKey));
  type Snapshot = {
    client: DriveClient;
    sourceKey: string;
    activationId: string | undefined;
    version: number;
    status: "ready" | "error";
    item: DriveItem;
  };
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, Snapshot>>(new Map());
  const latest = useRef(snapshots);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key contains every source URL and metadata value, excluding object identity
  useEffect(() => {
    let live = true;
    const next = new Map<string, Snapshot>();
    for (const item of initial) {
      const sourceKey = metadataKey(item);
      const previous = latest.current.get(item.url);
      if (
        previous?.client === client &&
        previous.activationId === activationId &&
        previous.version === version &&
        metadataKey(previous.item) === sourceKey
      ) {
        next.set(item.url, previous);
        continue;
      }
      const complete = (value: DriveItem, status: "ready" | "error") => {
        if (!live) return;
        if (status === "ready") {
          const items = hydrated.get(client) ?? new Map<string, DriveItem>();
          items.set(value.url, value);
          hydrated.set(client, items);
        }
        next.set(item.url, { client, sourceKey, activationId, version, status, item: value });
        latest.current = new Map(next);
        setSnapshots(latest.current);
      };
      client.stat(item.url).then(
        (value) => complete(value, "ready"),
        () => complete(item, "error"),
      );
    }
    latest.current = next;
    return () => {
      live = false;
    };
  }, [client, key, version, activationId]);
  return initial.map((item) => {
    const snapshot = snapshots.get(item.url);
    const sourceKey = metadataKey(item);
    const current =
      snapshot?.client === client &&
      snapshot.activationId === activationId &&
      // Keep this resource visible during background revalidation; never borrow
      // metadata from a previous selection, activation or account.
      (snapshot.sourceKey === sourceKey || metadataKey(snapshot.item) === sourceKey)
        ? snapshot
        : undefined;
    return { item: current?.item ?? item, status: current?.status ?? ("loading" as const) };
  });
}
